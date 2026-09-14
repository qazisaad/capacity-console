/**
 * End-to-end over real boundaries: the public @harness-control/runner pairs against this app's pairing routes,
 * connects to the gateway over a real WebSocket with a connection token, reads fixture accounts, and the
 * snapshot is persisted through the canonical reducer into PostgreSQL. Provider data is injected (labelled).
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { eq } from "drizzle-orm";
import { RunnerConnection } from "@harness-control/runner/connection";
import { RunnerConfigSchema } from "@harness-control/runner/config";
import { AccountUsageReader, normalizeCodexUsage, type AccountCollector } from "@harness-control/runner/accounts";
import { pairWithReferenceControlPlane, requestConnectionToken } from "@harness-control/runner/pairing";
import { db } from "~/server/db/context";
import { accountSources, observationHistory, pairingRequests, runners, runtimeLease } from "~/server/db/schema";
import { auth } from "~/server/auth/auth";
import { bootstrapAdmin, ensureInstallation } from "~/server/auth/bootstrap";
import { createOrganization } from "~/server/auth/organizations";
import { inviteMember, redeemInvitation } from "~/server/auth/invitations";
import { requirePrincipal, type Principal } from "~/server/auth/session";
import { approvePairing, createPairingRequest, exchangePairing, issueConnectionToken } from "~/server/hcp/pairing";
import { createRuntime, type Runtime } from "~/server/runtime";
import { assignAccount, listRunners, overview, refreshRunner, revokeRunner } from "~/server/monitoring";
import { readOrganizationAccounts } from "~/server/hcp/ingestion";
import { cookieHeaders } from "./helpers";

const PORT = 3999;
let server: Server;
const logs: string[] = [];
let runtime: Runtime;
let owner: Headers; let ownerP: Principal;
let dev: Headers; let devP: Principal;
let outsider: Headers; let outsiderP: Principal;

/** Minimal HTTP host for the three pairing routes plus the gateway upgrade, mirroring server/index.mjs without the UI. */
async function startHost(): Promise<void> {
  runtime = await createRuntime({ pollMs: 60_000, log: message => { logs.push(message); } });
  server = createServer(async (request, response) => {
    let body = ""; for await (const chunk of request) body += String(chunk);
    const json = (status: number, value: unknown) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
    try {
      const input: unknown = body ? JSON.parse(body) : {};
      if (request.url === "/pairing-codes") return json(200, await createPairingRequest(input));
      if (request.url === "/pairing-exchange") return json(200, await exchangePairing(input));
      if (request.url === "/runner-connection-token") return json(200, await issueConnectionToken(input));
      json(404, { error: "not found" });
    } catch (error) { json((error as { status?: number }).status ?? 400, { error: (error as Error).message }); }
  });
  server.on("upgrade", (request, socket, head) => runtime.handleUpgrade(request, socket, head));
  await new Promise<void>(resolve => server.listen(PORT, resolve));
}

const fixtureUsage = (percent: number, email: string): AccountCollector => async context =>
  normalizeCodexUsage(context, { account: { type: "chatgpt", email, planType: "pro" } }, { rateLimits: { primary: { usedPercent: percent, resetsAt: Math.ceil(Date.now() / 1000) + 86400, windowDurationMins: 10080 } } });

async function startRunner(runnerId: string, hostId: string, collector: AccountCollector, providers = ["codex-a"]) {
  const base = RunnerConfigSchema.parse({ runner_id: runnerId, host_id: hostId, control_plane_url: `ws://localhost:${PORT}/runner`,
    provider_instances: providers.map(id => ({ id, driver_kind: "account-fixture", account_usage: { scope_id: "acme" } })) });
  return {
    config: base,
    async pair() {
      let shown: string | undefined;
      const pairing = pairWithReferenceControlPlane({ controlPlaneUrl: base.control_plane_url, runnerId, hostId, onPairingCode: code => { shown = code.request_id; } });
      for (let attempt = 0; !shown && attempt < 200; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      return { requestId: shown!, result: pairing };
    },
    connect(credential: Awaited<ReturnType<typeof pairWithReferenceControlPlane>>["credential"]) {
      const reader = new AccountUsageReader(base, { collectors: new Map([["account-fixture", collector]]), cacheMs: 0 });
      const connection = new RunnerConnection({ config: base, runnerVersion: "test", accountUsage: reader, connectionTokenProvider: () => requestConnectionToken(base, credential), reconnect: { initialDelayMs: 200, maxDelayMs: 500 } });
      return connection;
    },
  };
}

async function untilPersisted(runnerRowId: string, minimum = 1): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const rows = await db().select().from(accountSources).where(eq(accountSources.runnerRowId, runnerRowId));
    if (rows.length >= minimum) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`snapshot was not persisted in time; gateway=${JSON.stringify(runtime.gateway.status())} lease=${runtime.lease.held} logs=${logs.join(" | ")}`);
}

describe("pairing, ingestion, isolation, revocation and restart", () => {
  beforeAll(async () => {
    process.env.BOOTSTRAP_TOKEN = "bootstrap-token-for-tests-0123456789";
    const { resetEnvForTests } = await import("~/server/env"); resetEnvForTests();
    await ensureInstallation();
    const admin = await bootstrapAdmin({ token: process.env.BOOTSTRAP_TOKEN, email: "owner@example.com", name: "Owner", password: "correct-horse-battery-staple" });
    owner = cookieHeaders(admin.cookies);
    await createOrganization(owner, { name: "Acme", slug: "acme" });
    ownerP = await requirePrincipal(owner);
    const invite = await inviteMember(owner, { email: "dev@example.com", role: "member" });
    dev = cookieHeaders((await redeemInvitation({ invitationId: invite.invitationId, name: "Dev", password: "another-long-password" })).cookies);
    devP = await requirePrincipal(dev);
    // A second, unrelated organization.
    const signUp = await auth().api.signUpEmail({ body: { email: "outsider@example.com", password: "outsider-long-password", name: "Outsider" }, headers: new Headers({ "x-capacity-internal-signup": (await import("~/server/auth/auth")).internalSignupMarker }), returnHeaders: true });
    outsider = cookieHeaders(signUp.headers.getSetCookie());
    await createOrganization(outsider, { name: "Rival", slug: "rival" });
    outsiderP = await requirePrincipal(outsider);
    await startHost();
  });
  afterAll(async () => { await runtime?.close(); await new Promise<void>(resolve => server?.close(() => resolve())); });

  test("a member pairs their own runner; the credential is redelivered only to the same exchange proof and never twice", async () => {
    const machine = await startRunner("runner-dev", "dev-laptop", fixtureUsage(96, "dev@example.com"));
    const { requestId, result } = await machine.pair();
    // Approval needs an authenticated member and the request id, never the short code. A member of another
    // organization approving binds the machine to *their* organization, not to Acme.
    await approvePairing(outsiderP, requestId);
    const row = await db().query.pairingRequests.findFirst({ where: eq(pairingRequests.id, requestId) });
    expect(row?.organizationId).toBe(outsiderP.organizationId);
    // Start over with a real Acme member approving a fresh request.
    const second = await startRunner("runner-dev2", "dev-laptop", fixtureUsage(96, "dev@example.com"));
    const pairing = await second.pair();
    await expect(approvePairing(devP, pairing.requestId)).resolves.toMatchObject({ runnerRowId: expect.any(String) });
    const paired = await pairing.result;
    expect(paired.credential.runner_id).toBe("runner-dev2");
    // Lost response: the same exchange proof gets the same credential; a wrong proof gets nothing.
    const redelivered = await exchangePairing({ request_id: pairing.requestId, runner_id: "runner-dev2", host_id: "dev-laptop", protocol_version: "hcp.v0", exchange_secret: "x".repeat(40) }).catch(error => error);
    expect(redelivered).toBeInstanceOf(Error);
    const runnerRows = await db().select().from(runners).where(eq(runners.runnerId, "runner-dev2"));
    expect(runnerRows).toHaveLength(1);
    expect(runnerRows[0]?.memberId).toBe(devP.memberId);
    await expect(approvePairing(devP, pairing.requestId)).rejects.toThrow(/already resolved/);
    await result;
  });

  test("connected runner reads fixture accounts; snapshot persists through the reducer; tenant isolation holds", async () => {
    const machine = await startRunner("runner-dev3", "dev-desk", fixtureUsage(96, "dev@example.com"), ["codex-a", "codex-b"]);
    const pairing = await machine.pair();
    const { runnerRowId } = await approvePairing(devP, pairing.requestId);
    const paired = await pairing.result;
    const connection = machine.connect(paired.credential);
    await connection.connect();
    await untilPersisted(runnerRowId, 2);
    const acme = await readOrganizationAccounts(ownerP.organizationId, new Date(), 300_000);
    expect(acme.accounts).toHaveLength(1); // same scoped account from two provider instances: one account, not summed
    expect(acme.accounts[0]?.sources).toHaveLength(2);
    expect(acme.accounts[0]?.observation.limits[0]?.used_percent).toBe(96);
    expect(acme.accounts[0]?.freshness).toBe("fresh");
    expect(JSON.stringify(acme)).not.toContain("dev@example.com");
    const rival = await readOrganizationAccounts(outsiderP.organizationId, new Date(), 300_000);
    expect(rival.accounts).toHaveLength(0);
    const ownerView = await overview(ownerP);
    expect(ownerView.accounts[0]?.decision.kind).toBe("review_capacity");
    const devView = await overview(devP);
    expect(devView.accounts).toHaveLength(1);
    const outsiderRunners = await listRunners(outsiderP);
    expect(outsiderRunners.map(runner => runner.id)).not.toContain(runnerRowId); // Rival only sees the machine its own member approved
    await expect(refreshRunner(outsiderP, runnerRowId)).rejects.toThrow(/not found in this organization/);
    await expect(revokeRunner(outsiderP, { runnerRowId, expectedGeneration: 1 })).rejects.toThrow(/not found/);
    const history = await db().select().from(observationHistory).where(eq(observationHistory.organizationId, ownerP.organizationId));
    expect(history.length).toBeGreaterThanOrEqual(2);
    // Assignment: admin confirms; member cannot; stale revision conflicts.
    const account = acme.accounts[0]!.assignment!;
    await expect(assignAccount(devP, { providerAccountId: account.providerAccountId, expectedRevision: account.revision, memberId: devP.memberId, verification: "verified" })).rejects.toThrow(/Only owners and admins/);
    const assigned = await assignAccount(ownerP, { providerAccountId: account.providerAccountId, expectedRevision: account.revision, memberId: devP.memberId, verification: "verified" });
    expect(assigned).toMatchObject({ revision: 2, verification: "verified" });
    await expect(assignAccount(ownerP, { providerAccountId: account.providerAccountId, expectedRevision: 1, memberId: null, verification: "unverified" })).rejects.toThrow(/changed/);
    await expect(assignAccount(outsiderP, { providerAccountId: account.providerAccountId, expectedRevision: 2, memberId: null, verification: "unverified" })).rejects.toThrow(/not found/);
    // Manual refresh coalesces and persists a fresh reading.
    const [first, second] = await Promise.all([refreshRunner(devP, runnerRowId), refreshRunner(devP, runnerRowId)]);
    expect(first.refreshed && second.refreshed).toBe(true);
    // Revocation fences the live socket and blocks future token issuance.
    const [runnerRow] = await db().select().from(runners).where(eq(runners.id, runnerRowId));
    await revokeRunner(devP, { runnerRowId, expectedGeneration: runnerRow!.connectionGeneration });
    for (let attempt = 0; attempt < 100 && (await listRunners(devP)).find(runner => runner.id === runnerRowId)?.connected; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    expect((await listRunners(devP)).find(runner => runner.id === runnerRowId)?.connected).toBe(false);
    await expect(requestConnectionToken(machine.config, paired.credential)).rejects.toThrow(/rejected/);
    await connection.close();
    // History is retained after revocation, labelled disconnected (runner revoked).
    const after = await readOrganizationAccounts(ownerP.organizationId, new Date(), 300_000);
    expect(after.accounts).toHaveLength(1);
  });

  test("unavailable and failing reads preserve last-good history; restart rehydrates and obtains a fresh read", async () => {
    let failing = false;
    const collector: AccountCollector = async context => { if (failing) throw new Error("private provider error"); return fixtureUsage(50, "dev@example.com")(context); };
    const machine = await startRunner("runner-dev4", "dev-air", collector);
    const pairing = await machine.pair();
    const { runnerRowId } = await approvePairing(devP, pairing.requestId);
    const paired = await pairing.result;
    let connection = machine.connect(paired.credential);
    await connection.connect();
    await untilPersisted(runnerRowId);
    failing = true;
    await refreshRunner(devP, runnerRowId);
    const projection = await readOrganizationAccounts(ownerP.organizationId, new Date(), 300_000);
    const card = projection.accounts.find(account => account.sources.some(source => source.runnerRowId === runnerRowId));
    expect(card?.freshness).toBe("unavailable");
    expect(card?.observation.limits[0]?.used_percent).toBe(50); // last successful observation retained
    expect(JSON.stringify(projection)).not.toContain("private provider error");
    // Restart the app runtime: state comes from PostgreSQL, then the reconnecting runner produces a fresh read.
    failing = false;
    await connection.close();
    const before = (await db().select().from(runners).where(eq(runners.id, runnerRowId)))[0]!.connectionGeneration;
    await runtime.close();
    server.close();
    await new Promise(resolve => setTimeout(resolve, 100));
    await startHost();
    connection = machine.connect(paired.credential);
    await connection.connect();
    for (let attempt = 0; attempt < 300; attempt++) {
      const [row] = await db().select().from(runners).where(eq(runners.id, runnerRowId));
      const sources = await db().select().from(accountSources).where(eq(accountSources.runnerRowId, runnerRowId));
      const state = sources[0]?.state as { latest: { status: string } } | undefined;
      if (row!.connectionGeneration > before && state?.latest.status === "available") break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const restored = await readOrganizationAccounts(ownerP.organizationId, new Date(), 300_000);
    const fresh = restored.accounts.find(account => account.sources.some(source => source.runnerRowId === runnerRowId));
    expect(fresh?.freshness).toBe("fresh");
    // A lease loss fences existing sockets; regaining it must leave the listener usable.
    await db().update(runtimeLease).set({ owner: "competing-process", expiresAt: new Date(Date.now() + 60_000) });
    expect(await runtime.lease.acquire()).toBe(false);
    expect(runtime.gateway.isConnected(runnerRowId)).toBe(false);
    await connection.close();
    await db().update(runtimeLease).set({ expiresAt: new Date(0) });
    expect(await runtime.lease.acquire()).toBe(true);
    connection = machine.connect(paired.credential);
    await connection.connect();
    for (let attempt = 0; attempt < 200 && !runtime.gateway.isConnected(runnerRowId); attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    expect((await refreshRunner(devP, runnerRowId)).refreshed).toBe(true);
    await connection.close();
  });
});
