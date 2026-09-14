import { beforeAll, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import { ProviderInstanceConfigSchema } from "@harness-control/runner/config";
import { normalizeCodexUsage } from "@harness-control/runner/accounts";
import { type HcpAccountsSnapshotPayload } from "@harness-control/protocol";
import { db } from "~/server/db/context";
import { installation, organization, runners, observationHistory } from "~/server/db/schema";
import { bootstrapAdmin, ensureInstallation } from "~/server/auth/bootstrap";
import { handleAuthRequest } from "~/server/auth/auth";
import { createOrganization } from "~/server/auth/organizations";
import { inviteMember, redeemInvitation } from "~/server/auth/invitations";
import { requirePrincipal, type Principal } from "~/server/auth/session";
import { overview, accountDetail } from "~/server/monitoring";
import { persistSnapshot } from "~/server/hcp/ingestion";
import { cookieHeaders } from "./helpers";

let owner: Headers;
let ownerP: Principal;
let devP: Principal;
const token = "review-bootstrap-token-0123456789";
const password = "review-password-0123456789";

beforeAll(async () => {
  process.env.BOOTSTRAP_TOKEN = token;
  const { resetEnvForTests } = await import("~/server/env"); resetEnvForTests();
  await ensureInstallation();
});

async function failAudit(): Promise<void> {
  await db().execute(sql`CREATE FUNCTION review_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$`);
  await db().execute(sql`CREATE TRIGGER review_fail_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION review_fail_audit()`);
}
async function restoreAudit(): Promise<void> {
  await db().execute(sql`DROP TRIGGER review_fail_audit ON audit_events`);
  await db().execute(sql`DROP FUNCTION review_fail_audit()`);
}

test("failed bootstrap rolls back user, session and token consumption; retry succeeds", async () => {
  await failAudit();
  try {
    await expect(bootstrapAdmin({ token, email: "owner@example.com", name: "Owner", password })).rejects.toThrow();
    expect(await db().query.user.findMany()).toHaveLength(0);
    expect(await db().query.session.findMany()).toHaveLength(0);
    expect((await db().select().from(installation))[0]!.bootstrapConsumedAt).toBeNull();
  } finally { await restoreAudit(); }
  owner = cookieHeaders((await bootstrapAdmin({ token, email: "owner@example.com", name: "Owner", password })).cookies);
});

test("organization creation rolls back on audit failure and cannot bypass the app service", async () => {
  await failAudit();
  try {
    await expect(createOrganization(owner, { name: "Rollback", slug: "rollback" })).rejects.toThrow();
    expect(await db().select().from(organization)).toHaveLength(0);
    expect(await db().query.member.findMany()).toHaveLength(0);
  } finally { await restoreAudit(); }
  const headers = new Headers(owner); headers.set("content-type", "application/json");
  const response = await handleAuthRequest(new Request(`${process.env.APP_ORIGIN}/api/auth/organization/create`, {
    method: "POST", headers, body: JSON.stringify({ name: "Bypass", slug: "bypass" }),
  }));
  expect(response.status).toBe(403);
  expect(await db().select().from(organization)).toHaveLength(0);
  await createOrganization(owner, { name: "Acme", slug: "acme" });
  ownerP = await requirePrincipal(owner);
  const invite = await inviteMember(owner, { email: "dev@example.com", role: "member" });
  devP = await requirePrincipal(cookieHeaders((await redeemInvitation({ invitationId: invite.invitationId, name: "Dev", password })).cookies));
});

function snapshot(hostId: string, percent: number, observedAt: Date): HcpAccountsSnapshotPayload {
  return { request_id: "review-read", host_id: hostId, providers: [{ provider_instance_id: "codex", observation: { ...normalizeCodexUsage(
    { hostId, provider: ProviderInstanceConfigSchema.parse({ id: "codex", driver_kind: "codex", account_usage: { scope_id: "shared" } }), signal: new AbortController().signal },
    { account: { type: "chatgpt", email: "same@example.com", planType: "pro" } },
    { rateLimits: { primary: { usedPercent: percent, resetsAt: Math.ceil(Date.now() / 1000) + 86400, windowDurationMins: 10080 } } },
  ), observed_at: observedAt.toISOString() } }] };
}

test("members see only their own source observations and history even for the same provider account", async () => {
  const now = Date.now();
  for (const [id, principal, percent, offset] of [["dev", devP, 20, -1000], ["owner", ownerP, 90, 0]] as const) {
    await db().insert(runners).values({ id, organizationId: ownerP.organizationId, memberId: principal.memberId, runnerId: id, hostId: id, credentialId: id, credentialSecretHash: "unused-fixture", connectionGeneration: 1 });
    await persistSnapshot({ organizationId: ownerP.organizationId, runnerRowId: id, generation: 1, snapshot: snapshot(id, percent, new Date(now + offset)), receivedAt: new Date(now) });
  }
  const full = await overview(ownerP);
  expect(full.accounts).toHaveLength(1);
  expect(full.accounts[0]!.sources).toHaveLength(2);
  expect(full.accounts[0]!.observation.limits[0]!.used_percent).toBe(90);
  const own = await overview(devP);
  expect(own.accounts[0]!.sources.map(source => source.runnerRowId)).toEqual(["dev"]);
  expect(own.accounts[0]!.observation.limits[0]!.used_percent).toBe(20);
  expect(own.members.map(member => member.id)).toEqual([devP.memberId]);
  const detail = await accountDetail(devP, own.accounts[0]!.assignment!.providerAccountId);
  expect(detail.history).toHaveLength(1);
  expect(detail.history[0]!.hostId).toBe("dev");
});

test("stale generations, revocation and older snapshots cannot overwrite persisted observations", async () => {
  const before = await db().select().from(observationHistory);
  await db().update(runners).set({ connectionGeneration: 2 }).where(eq(runners.id, "dev"));
  const input = { organizationId: ownerP.organizationId, runnerRowId: "dev", generation: 1, snapshot: snapshot("dev", 99, new Date()), receivedAt: new Date() };
  await expect(persistSnapshot(input)).rejects.toThrow(/generation/);
  await persistSnapshot({ ...input, generation: 2, snapshot: snapshot("dev", 99, new Date(0)) });
  expect(await db().select().from(observationHistory)).toHaveLength(before.length);
  expect((await overview(devP)).accounts[0]!.observation.limits[0]!.used_percent).toBe(20);
  await db().update(runners).set({ revokedAt: new Date() }).where(eq(runners.id, "dev"));
  await expect(persistSnapshot({ ...input, generation: 2 })).rejects.toThrow(/generation/);
});
