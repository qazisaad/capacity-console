import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db/context";
import { accountSources, auditEvents, member, providerAccounts, runners, user } from "./db/schema";
import { recordAudit } from "./audit";
import { AuthorizationError, type Principal } from "./auth/session";
import { gateway } from "./hcp/gateway-instance";
import { readOrganizationAccounts, readSourceHistory, type AccountProjection } from "./hcp/ingestion";
import { activePolicy } from "./capacity/policies";
import { evaluateCapacity, type CapacityDecision } from "./capacity/policy";

export type RunnerView = { id: string; runnerId: string; hostId: string; memberId: string; memberName: string; connected: boolean; accountUsage: boolean; lastSeenAt: string | null; revokedAt: string | null; generation: number; lastReadAt?: string; lastError?: string; sourceCount: number };

/** Members see their own machines; owners, admins and auditors see the organization's. */
export async function listRunners(principal: Principal): Promise<RunnerView[]> {
  const own = principal.role === "member";
  const rows = await db().select({ runner: runners, memberName: user.name }).from(runners)
    .innerJoin(member, eq(member.id, runners.memberId)).innerJoin(user, eq(user.id, member.userId))
    .where(own ? and(eq(runners.organizationId, principal.organizationId), eq(runners.memberId, principal.memberId)) : eq(runners.organizationId, principal.organizationId))
    .orderBy(desc(runners.createdAt));
  const counts = rows.length ? await db().select({ runnerRowId: accountSources.runnerRowId }).from(accountSources).where(inArray(accountSources.runnerRowId, rows.map(row => row.runner.id))) : [];
  const live = new Map((gateway()?.status() ?? []).map(status => [status.runnerRowId, status]));
  return rows.map(({ runner, memberName }) => {
    const status = live.get(runner.id);
    return { id: runner.id, runnerId: runner.runnerId, hostId: runner.hostId, memberId: runner.memberId, memberName, connected: status?.accepted ?? false, accountUsage: status?.accountUsage ?? false,
      lastSeenAt: runner.lastSeenAt?.toISOString() ?? null, revokedAt: runner.revokedAt?.toISOString() ?? null, generation: runner.connectionGeneration,
      ...(status?.lastReadAt ? { lastReadAt: status.lastReadAt } : {}), ...(status?.lastError ? { lastError: status.lastError } : {}),
      sourceCount: counts.filter(count => count.runnerRowId === runner.id).length };
  });
}

async function ownedRunner(principal: Principal, runnerRowId: string) {
  const runner = await db().query.runners.findFirst({ where: and(eq(runners.id, runnerRowId), eq(runners.organizationId, principal.organizationId)) });
  if (!runner) throw new AuthorizationError(403, "Runner not found in this organization.");
  if (principal.role === "member" && runner.memberId !== principal.memberId) throw new AuthorizationError(403, "You can only manage your own machines.");
  if (principal.role === "auditor") throw new AuthorizationError(403, "Auditors have read-only access.");
  return runner;
}

/** Coalesced, bounded manual refresh. A matching persisted snapshot completes it; there is no durable job. */
export async function refreshRunner(principal: Principal, runnerRowId: string): Promise<{ refreshed: boolean; message: string }> {
  const runner = await ownedRunner(principal, runnerRowId);
  const live = gateway();
  if (!live || !live.isConnected(runner.id)) return { refreshed: false, message: "This machine is not connected right now." };
  try { await live.read(runner.id); return { refreshed: true, message: "Fresh reading persisted." }; }
  catch (error) { return { refreshed: false, message: error instanceof Error ? error.message : "Account read failed." }; }
}

export const revokeInputSchema = z.object({ runnerRowId: z.string().min(1), expectedGeneration: z.number().int().nonnegative() });
/** Credential revocation plus socket fencing. Observations are kept under retention and labelled disconnected. */
export async function revokeRunner(principal: Principal, input: z.infer<typeof revokeInputSchema>): Promise<void> {
  const data = revokeInputSchema.parse(input);
  const runner = await ownedRunner(principal, data.runnerRowId);
  if (runner.revokedAt) throw new AuthorizationError(409, "This machine is already revoked.");
  if (runner.connectionGeneration !== data.expectedGeneration) throw new AuthorizationError(409, "This machine's connection state changed. Refresh and retry.");
  await db().transaction(async tx => {
    const [updated] = await tx.update(runners).set({ revokedAt: new Date(), connectionGeneration: data.expectedGeneration + 1 })
      .where(and(eq(runners.id, runner.id), eq(runners.connectionGeneration, data.expectedGeneration))).returning({ id: runners.id });
    if (!updated) throw new AuthorizationError(409, "This machine's connection state changed. Refresh and retry.");
    await recordAudit(tx, { organizationId: principal.organizationId, actorUserId: principal.userId, kind: "runner.revoked", subjectType: "runner", subjectId: runner.id, details: { hostId: runner.hostId, memberId: runner.memberId } });
  });
  gateway()?.disconnect(runner.id, "credential revoked");
}

export type AccountCard = AccountProjection & { decision: CapacityDecision; memberName: string | null };

/** Overview data: reducer projection plus the active policy's explanation for each account. Unknown values stay unknown. */
export async function overview(principal: Principal) {
  const policy = await activePolicy(principal.organizationId);
  const now = new Date();
  const projection = await readOrganizationAccounts(principal.organizationId, now, policy.policy.max_observation_age_seconds * 1000, db(), principal.role === "member" ? principal.memberId : undefined);
  const members = await db().select({ id: member.id, name: user.name }).from(member).innerJoin(user, eq(user.id, member.userId)).where(and(eq(member.organizationId, principal.organizationId), ...(principal.role === "member" ? [eq(member.id, principal.memberId)] : [])));
  const visible = principal.role === "member"
    ? projection.accounts.filter(account => account.sources.some(source => source.memberId === principal.memberId))
    : projection.accounts;
  const accounts: AccountCard[] = visible.map(account => ({
    ...account,
    decision: evaluateCapacity({ view: { account: account.account, observation: account.observation, freshness: account.freshness, sources: account.sources.map(source => ({ host_id: source.hostId, provider_instance_id: source.providerInstanceId })) }, policy: policy.policy, now }),
    memberName: members.find(candidate => candidate.id === account.assignment?.memberId)?.name ?? null,
  }));
  const unavailableSources = principal.role === "member" ? projection.unavailableSources.filter(source => source.memberId === principal.memberId) : projection.unavailableSources;
  return { generatedAt: now.toISOString(), policy, accounts, unavailableSources, members };
}

export async function accountDetail(principal: Principal, providerAccountId: string) {
  const data = await overview(principal);
  const account = data.accounts.find(candidate => candidate.assignment?.providerAccountId === providerAccountId);
  if (!account) throw new AuthorizationError(403, "Account not found in this organization.");
  const history = await Promise.all(account.sources.map(async source => ({ sourceId: source.sourceId, hostId: source.hostId, providerInstanceId: source.providerInstanceId, samples: await readSourceHistory(principal.organizationId, source.sourceId) })));
  return { ...account, history, policy: data.policy, members: data.members };
}

export const assignInputSchema = z.object({ providerAccountId: z.string().min(1), expectedRevision: z.number().int().positive(), memberId: z.string().min(1).nullable(), verification: z.enum(["unverified", "verified"]) });
/** Association is an administrator confirmation, never a guess from names or emails. Conflicts are recorded, not resolved automatically. */
export async function assignAccount(principal: Principal, input: z.infer<typeof assignInputSchema>) {
  const data = assignInputSchema.parse(input);
  if (!["owner", "admin"].includes(principal.role)) throw new AuthorizationError(403, "Only owners and admins assign accounts.");
  return db().transaction(async tx => {
    const [account] = await tx.select().from(providerAccounts).where(and(eq(providerAccounts.id, data.providerAccountId), eq(providerAccounts.organizationId, principal.organizationId))).for("update");
    if (!account) throw new AuthorizationError(403, "Account not found in this organization.");
    if (account.revision !== data.expectedRevision) throw new AuthorizationError(409, "This account changed. Refresh and retry.");
    if (data.memberId) {
      const target = await tx.query.member.findFirst({ where: and(eq(member.id, data.memberId), eq(member.organizationId, principal.organizationId)) });
      if (!target) throw new AuthorizationError(403, "That member is not part of this organization.");
    }
    const verification = data.memberId ? data.verification : "unverified";
    const [updated] = await tx.update(providerAccounts).set({ memberId: data.memberId, verification, revision: account.revision + 1, updatedAt: new Date() }).where(eq(providerAccounts.id, account.id)).returning();
    await recordAudit(tx, { organizationId: principal.organizationId, actorUserId: principal.userId, kind: "account.assigned", subjectType: "provider_account", subjectId: account.id, details: { memberId: data.memberId, verification, revision: updated!.revision } });
    return { revision: updated!.revision, memberId: updated!.memberId, verification: updated!.verification };
  });
}

export async function listAudit(principal: Principal, limit = 100) {
  if (principal.role === "member") throw new AuthorizationError(403, "Audit access requires an organization role above member.");
  const rows = await db().select({ event: auditEvents, actorName: user.name }).from(auditEvents).leftJoin(user, eq(user.id, auditEvents.actorUserId))
    .where(eq(auditEvents.organizationId, principal.organizationId)).orderBy(desc(auditEvents.createdAt)).limit(limit);
  return rows.map(({ event, actorName }) => ({ id: event.id, kind: event.kind, subjectType: event.subjectType, subjectId: event.subjectId, details: event.details as Record<string, string | number | boolean | null>, actorName, createdAt: event.createdAt.toISOString() }));
}

export async function listMembers(principal: Principal) {
  const rows = await db().select({ id: member.id, role: member.role, name: user.name, email: user.email, createdAt: member.createdAt }).from(member).innerJoin(user, eq(user.id, member.userId)).where(eq(member.organizationId, principal.organizationId));
  return rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString(), email: principal.role === "member" && row.id !== principal.memberId ? null : row.email }));
}
