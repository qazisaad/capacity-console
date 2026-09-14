import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { eq, sql } from "drizzle-orm";
import { WebSocket, WebSocketServer } from "ws";
import { HCP_MESSAGE_MAX_ENCODED_BYTES, HCP_VERSION, HcpAccountUsageReducer } from "@harness-control/protocol";
import { HcpHostConnection } from "@harness-control/sdk";
import type { Db } from "../db/client";
import { runners } from "../db/schema";
import { runtimeState } from "../runtime-state";
import { consumeConnectionToken } from "./pairing";
import { loadRunnerSources, persistSnapshot } from "./ingestion";

type RunnerRow = typeof runners.$inferSelect;
type Live = {
  runner: RunnerRow; generation: number; socket: WebSocket; connection: HcpHostConnection; reducer: HcpAccountUsageReducer;
  accepted: boolean; accountUsage: boolean; reading?: Promise<void>; acceptedAt?: string; lastReadAt?: string; lastError?: string;
};
export type RunnerStatus = { runnerRowId: string; generation: number; accepted: boolean; accountUsage: boolean; reading: boolean; acceptedAt?: string; lastReadAt?: string; lastError?: string };

/**
 * Machine-to-server transport. Authentication happens before HCP acceptance, identity is matched against `host.hello`,
 * each socket gets a new connection generation and callbacks from a replaced socket are fenced.
 */
export class RunnerGateway {
  readonly #sockets = new WebSocketServer({ noServer: true, maxPayload: HCP_MESSAGE_MAX_ENCODED_BYTES });
  readonly #live = new Map<string, Live>();
  constructor(private readonly db: Db, private readonly options: { heartbeatSeconds?: number; readTimeoutMs?: number; log?: (message: string) => void } = {}) {}

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const reject = (status: number, text: string) => { socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/runner") return reject(404, "Not Found");
    if (!runtimeState.leaseHeld || runtimeState.shuttingDown) return reject(503, "Service Unavailable");
    const bearer = /^Bearer\s+(\S+)$/.exec(request.headers.authorization ?? "");
    const runnerRowId = bearer ? consumeConnectionToken(bearer[1]!) : undefined;
    if (!runnerRowId) return reject(401, "Unauthorized");
    // All database work happens before the upgrade completes so the message listener is attached
    // synchronously: the runner sends host.hello immediately after the socket opens.
    this.#prepare(runnerRowId).then(prepared => {
      if (!prepared) return reject(403, "Forbidden");
      this.#sockets.handleUpgrade(request, socket, head, ws => this.#attach(ws, prepared.runner, prepared.generation, prepared.reducer));
    }).catch(() => reject(503, "Service Unavailable"));
  }

  async #prepare(runnerRowId: string): Promise<{ runner: RunnerRow; generation: number; reducer: HcpAccountUsageReducer } | undefined> {
    const runner = await this.db.query.runners.findFirst({ where: eq(runners.id, runnerRowId) });
    if (!runner || runner.revokedAt) return undefined;
    const [updated] = await this.db.update(runners).set({ connectionGeneration: sql`${runners.connectionGeneration} + 1`, lastSeenAt: sql`now()` }).where(eq(runners.id, runner.id)).returning();
    const reducer = new HcpAccountUsageReducer(await loadRunnerSources(runner.id, this.db));
    return { runner: updated!, generation: updated!.connectionGeneration, reducer };
  }

  #attach(socket: WebSocket, runner: RunnerRow, generation: number, reducer: HcpAccountUsageReducer): void {
    const previous = this.#live.get(runner.id);
    if (previous) this.#fence(previous, "replaced by a newer connection");
    const connection = new HcpHostConnection({ send: message => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); } }, { accounts: reducer });
    const live: Live = { runner, generation, socket, connection, reducer, accepted: false, accountUsage: false };
    this.#live.set(runner.id, live);
    socket.on("message", raw => {
      if (this.#live.get(runner.id) !== live) return;
      try {
        const received = live.connection.receive(raw.toString());
        const message = received.message;
        if (message.type === "host.hello") {
          const hello = message.payload;
          if (hello.runner_id !== runner.runnerId || hello.host_id !== runner.hostId) throw new Error("hello identity does not match the authenticated runner");
          if (!hello.supported_protocol_versions.includes(HCP_VERSION)) throw new Error("unsupported protocol version");
          live.accountUsage = hello.capabilities.includes("account_usage");
          live.connection.accept({ protocol_version: HCP_VERSION, heartbeat_interval_seconds: this.options.heartbeatSeconds ?? 15 });
          live.accepted = true; live.acceptedAt = new Date().toISOString();
          if (live.accountUsage) void this.read(runner.id).catch(() => undefined);
        } else if (message.type === "host.heartbeat") {
          void this.db.update(runners).set({ lastSeenAt: sql`now()` }).where(eq(runners.id, runner.id)).catch(() => undefined);
        }
      } catch (error) {
        this.options.log?.(`runner ${runner.id}: protocol rejected (${error instanceof Error ? error.message : "invalid message"})`);
        live.lastError = "Runner protocol validation failed.";
        socket.close(1008, "protocol");
      }
    });
    socket.on("close", () => { live.connection.disconnect(); if (this.#live.get(runner.id) === live) this.#live.delete(runner.id); });
    socket.on("error", () => { /* close follows */ });
  }

  #fence(live: Live, reason: string): void {
    live.accepted = false;
    live.connection.disconnect();
    if (live.socket.readyState === WebSocket.OPEN || live.socket.readyState === WebSocket.CONNECTING) live.socket.close(4000, reason);
  }

  /** Read opted-in accounts for one runner; concurrent requests coalesce into the in-flight read. */
  read(runnerRowId: string): Promise<void> {
    const live = this.#live.get(runnerRowId);
    if (!live || !live.accepted) return Promise.reject(new Error("Runner is not connected."));
    if (!live.accountUsage) return Promise.reject(new Error("Runner does not advertise account usage."));
    if (live.reading) return live.reading;
    live.reading = (async () => {
      const snapshot = await live.connection.readAccounts({}, undefined, { timeoutMs: this.options.readTimeoutMs ?? 150_000 });
      if (this.#live.get(runnerRowId) !== live) return; // replaced meanwhile: the SDK already rejected mismatched hosts; never persist for a stale generation
      await persistSnapshot({ organizationId: live.runner.organizationId, runnerRowId, snapshot: snapshot.payload, states: live.reducer.snapshot(), receivedAt: new Date() }, this.db);
      live.lastReadAt = new Date().toISOString(); delete live.lastError;
    })().catch(error => { live.lastError = error instanceof Error && /timed out|timeout/i.test(error.message) ? "Account read timed out." : "Account read failed."; throw error; })
      .finally(() => { delete live.reading; });
    return live.reading;
  }

  /** Scheduler entry point: reads every accepted runner with a small jitter; failures are recorded per runner. */
  readAll(jitterMs = 10_000): void {
    for (const [runnerRowId, live] of this.#live) {
      if (!live.accepted || !live.accountUsage) continue;
      setTimeout(() => { void this.read(runnerRowId).catch(() => undefined); }, Math.random() * jitterMs).unref();
    }
  }

  status(): RunnerStatus[] {
    return [...this.#live.values()].map(live => ({ runnerRowId: live.runner.id, generation: live.generation, accepted: live.accepted, accountUsage: live.accountUsage, reading: !!live.reading,
      ...(live.acceptedAt ? { acceptedAt: live.acceptedAt } : {}), ...(live.lastReadAt ? { lastReadAt: live.lastReadAt } : {}), ...(live.lastError ? { lastError: live.lastError } : {}) }));
  }

  isConnected(runnerRowId: string): boolean { return this.#live.get(runnerRowId)?.accepted ?? false; }

  /** Revocation and offboarding close the live socket immediately; token issuance is refused by the database state. */
  disconnect(runnerRowId: string, reason: string): void {
    const live = this.#live.get(runnerRowId);
    if (live) { this.#fence(live, reason); this.#live.delete(runnerRowId); }
  }

  async close(): Promise<void> {
    for (const live of this.#live.values()) this.#fence(live, "server shutting down");
    this.#live.clear();
    for (const client of this.#sockets.clients) client.terminate();
    await new Promise<void>(resolve => this.#sockets.close(() => resolve()));
  }
}
