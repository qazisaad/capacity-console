import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { HcpAccountUsageReducer, accountSourceStateSchema, accountUsageObservationSchema, type AccountSourceState, type AccountUsageObservation, type AccountUsageView, type HcpAccountsSnapshotPayload } from "@harness-control/protocol";
import type { Db } from "../db/client";
import { db } from "../db/context";
import { accountSources, observationHistory, providerAccounts, runners } from "../db/schema";
import { randomId } from "../secrets";

/** Source states for one runner, exactly as the canonical reducer expects them. */
export async function loadRunnerSources(runnerRowId: string, handle: Db = db()): Promise<AccountSourceState[]> {
  const rows = await handle.select({ state: accountSources.state }).from(accountSources).where(and(eq(accountSources.runnerRowId, runnerRowId), isNull(accountSources.retiredAt)));
  return rows.map(row => accountSourceStateSchema.parse(row.state));
}

/**
 * Reduce a correlated snapshot from locked durable state. Omitted providers are untouched.
 * The observation is appended to history; provider accounts are upserted without touching assignment or verification.
 */
export async function persistSnapshot(input: {
  organizationId: string; runnerRowId: string; generation: number; snapshot: HcpAccountsSnapshotPayload; receivedAt: Date;
}, handle: Db = db()): Promise<void> {
  await handle.transaction(async tx => {
    const [runner] = await tx.select().from(runners).where(and(eq(runners.id, input.runnerRowId), eq(runners.organizationId, input.organizationId))).for("update");
    if (!runner || runner.revokedAt || runner.connectionGeneration !== input.generation || runner.hostId !== input.snapshot.host_id) {
      throw new Error("Runner generation is no longer authorized.");
    }
    const stored = await tx.select().from(accountSources).where(eq(accountSources.runnerRowId, runner.id));
    const reducer = new HcpAccountUsageReducer(stored.filter(source => !source.retiredAt).map(source => accountSourceStateSchema.parse(source.state)));
    reducer.apply(input.snapshot);
    const states = reducer.snapshot();
    for (const reading of input.snapshot.providers) {
      const prior = stored.find(source => source.providerInstanceId === reading.provider_instance_id);
      if (prior?.retiredAt) continue;
      if (prior && Date.parse(accountSourceStateSchema.parse(prior.state).latest.observed_at) >= Date.parse(reading.observation.observed_at)) continue;
      const state = states.find(candidate => candidate.host_id === input.snapshot.host_id && candidate.provider_instance_id === reading.provider_instance_id);
      if (!state) continue;
      const accountKey = state.last_success?.account.key ?? null;
      const [source] = await tx.insert(accountSources)
        .values({ id: randomId(), organizationId: input.organizationId, runnerRowId: input.runnerRowId, providerInstanceId: reading.provider_instance_id, state, accountKey, receivedAt: input.receivedAt })
        .onConflictDoUpdate({ target: [accountSources.organizationId, accountSources.runnerRowId, accountSources.providerInstanceId], set: { state, accountKey, receivedAt: input.receivedAt, retiredAt: null } })
        .returning({ id: accountSources.id });
      await tx.insert(observationHistory)
        .values({ organizationId: input.organizationId, sourceId: source!.id, observedAt: new Date(reading.observation.observed_at), receivedAt: input.receivedAt, observation: reading.observation })
        .onConflictDoNothing();
      if (reading.observation.status === "available") {
        const account = reading.observation.account;
        await tx.insert(providerAccounts)
          .values({ id: randomId(), organizationId: input.organizationId, provider: account.provider, accountKey: account.key, label: account.label, scopeSource: account.scope_source })
          .onConflictDoUpdate({ target: [providerAccounts.organizationId, providerAccounts.provider, providerAccounts.accountKey], set: { label: account.label, updatedAt: sql`now()` } });
      }
    }
    await tx.update(runners).set({ lastSeenAt: input.receivedAt }).where(eq(runners.id, input.runnerRowId));
  });
}

export type SourceRef = { sourceId: string; runnerRowId: string; hostId: string; providerInstanceId: string; memberId: string; receivedAt: string; latestStatus: "available" | "unavailable"; unavailableReason?: string; unavailableMessage?: string };
export type AccountProjection = {
  account: AccountUsageView["account"]; observation: AccountUsageView["observation"]; freshness: AccountUsageView["freshness"];
  sources: SourceRef[];
  assignment: { providerAccountId: string; memberId: string | null; verification: "unverified" | "verified" | "conflict"; revision: number } | null;
};

/**
 * Organization-wide projection through the canonical reducer. Sources are namespaced by runner row so two machines
 * that share a hostname label never collide; the same account seen on several machines is one account, never summed.
 */
export async function readOrganizationAccounts(organizationId: string, now: Date, maxAgeMs: number, handle: Db = db(), visibleMemberId?: string): Promise<{ accounts: AccountProjection[]; unavailableSources: SourceRef[] }> {
  const rows = await handle.select({ id: accountSources.id, runnerRowId: accountSources.runnerRowId, providerInstanceId: accountSources.providerInstanceId, state: accountSources.state, receivedAt: accountSources.receivedAt, hostId: runners.hostId, memberId: runners.memberId, revokedAt: runners.revokedAt })
    .from(accountSources).innerJoin(runners, eq(runners.id, accountSources.runnerRowId))
    .where(and(eq(accountSources.organizationId, organizationId), isNull(accountSources.retiredAt), ...(visibleMemberId ? [eq(runners.memberId, visibleMemberId)] : [])));
  const refs = new Map<string, SourceRef>();
  const states: AccountSourceState[] = [];
  for (const row of rows) {
    const state = accountSourceStateSchema.parse(row.state);
    const key = JSON.stringify([row.runnerRowId, row.providerInstanceId]);
    refs.set(key, { sourceId: row.id, runnerRowId: row.runnerRowId, hostId: row.hostId, providerInstanceId: row.providerInstanceId, memberId: row.memberId, receivedAt: row.receivedAt.toISOString(),
      latestStatus: state.latest.status, ...(state.latest.status === "unavailable" ? { unavailableReason: state.latest.reason, unavailableMessage: state.latest.message } : {}) });
    states.push({ ...state, host_id: row.runnerRowId });
  }
  const reducer = new HcpAccountUsageReducer(states);
  const accounts = await handle.select().from(providerAccounts).where(eq(providerAccounts.organizationId, organizationId));
  const views = reducer.accounts(now, maxAgeMs).map(view => {
    const assignment = accounts.find(account => account.provider === view.account.provider && account.accountKey === view.account.key);
    return {
      account: view.account, observation: view.observation, freshness: view.freshness,
      sources: view.sources.map(source => refs.get(JSON.stringify([source.host_id, source.provider_instance_id]))!).filter(Boolean),
      assignment: assignment ? { providerAccountId: assignment.id, memberId: visibleMemberId && assignment.memberId !== visibleMemberId ? null : assignment.memberId, verification: assignment.verification, revision: assignment.revision } : null,
    };
  });
  const unavailableSources = states.filter(state => !state.last_success).map(state => refs.get(JSON.stringify([state.host_id, state.provider_instance_id]))!);
  return { accounts: views, unavailableSources };
}

export type HistorySample = { observedAt: string; receivedAt: string; observation: AccountUsageObservation };
export async function readSourceHistory(organizationId: string, sourceId: string, limit = 48, handle: Db = db()): Promise<HistorySample[]> {
  const rows = await handle.select().from(observationHistory).where(and(eq(observationHistory.organizationId, organizationId), eq(observationHistory.sourceId, sourceId))).orderBy(desc(observationHistory.observedAt)).limit(limit);
  return rows.map(row => ({ observedAt: row.observedAt.toISOString(), receivedAt: row.receivedAt.toISOString(), observation: accountUsageObservationSchema.parse(row.observation) }));
}
