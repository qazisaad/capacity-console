import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { db, closeDb } from "./db/context";
import { schemaStatus } from "./db/schema-version";
import { env } from "./env";
import { ensureInstallation } from "./auth/bootstrap";
import { RuntimeLease } from "./lease";
import { RunnerGateway } from "./hcp/gateway";
import { setGateway } from "./hcp/gateway-instance";
import { purgeExpiredPairingEnvelopes } from "./hcp/pairing";
import { runtimeState } from "./runtime-state";

export type Runtime = {
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): Promise<void>;
  gateway: RunnerGateway;
  lease: RuntimeLease;
};

/**
 * Start the single supported app process: configuration, schema check, installation row, singleton lease,
 * WebSocket gateway and the one background loop (due reads with jitter, pairing envelope purge).
 */
export async function createRuntime(options: { pollMs?: number; log?: (message: string) => void } = {}): Promise<Runtime> {
  const log = options.log ?? ((message: string) => console.log(message));
  env();
  runtimeState.shuttingDown = false;
  const schema = await schemaStatus(db());
  if (!schema.ok) log(`schema mismatch: database has ${schema.applied ?? "no migrations"}, build expects ${schema.expected}. Run npm run db:migrate. Readiness will fail.`);
  else await ensureInstallation();
  const gateway = new RunnerGateway(db(), { log });
  setGateway(gateway);
  const lease = new RuntimeLease(db(), { onLost: () => { log("runtime lease lost: fencing runner connections"); void gateway.close(); } });
  if (schema.ok) {
    if (!(await lease.acquire())) log("another app process holds the runtime lease; this process serves HTTP only until the lease expires");
    lease.start();
  }
  const pollMs = options.pollMs ?? 60_000;
  const loop = setInterval(() => {
    if (!lease.held) return;
    gateway.readAll(Math.min(10_000, pollMs / 6));
    void purgeExpiredPairingEnvelopes().catch(() => undefined);
  }, pollMs);
  loop.unref();
  return {
    gateway, lease,
    handleUpgrade: (request, socket, head) => gateway.handleUpgrade(request, socket, head),
    async close() {
      runtimeState.shuttingDown = true;
      clearInterval(loop);
      await gateway.close();
      setGateway(undefined);
      await lease.release();
      await closeDb();
    },
  };
}
