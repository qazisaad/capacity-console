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
 * Persist the reducer's post-apply state for each provider in a correlated snapshot. Omitted providers are untouched.
 * The observation is appended to history; provider accounts are upserted without touching assignment or verification.
 */
export async function persistSnapshot(input: {
  organizationId: string; runnerRowId: string; snapshot: HcpAccountsSnapshotPayload; states: readonly AccountSourceState[]; receivedAt: Date;
}, handle: Db = db()): Promise<void> {
  await handle.transaction(async tx => {
    for (const reading of input.snapshot.providers) {
      const state = input.states.find(candidate => candidate.host_id === input.snapshot.host_id && candidate.provider_instance_id === reading.provider_instance_id);
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
export async function readOrganizationAccounts(organizationId: string, now: Date, maxAgeMs: number, handle: Db = db()): Promise<{ accounts: AccountProjection[]; unavailableSources: SourceRef[] }> {
  const rows = await handle.select({ id: accountSources.id, runnerRowId: accountSources.runnerRowId, providerInstanceId: accountSources.providerInstanceId, state: accountSources.state, receivedAt: accountSources.receivedAt, hostId: runners.hostId, memberId: runners.memberId, revokedAt: runners.revokedAt })
    .from(accountSources).innerJoin(runners, eq(runners.id, accountSources.runnerRowId))
    .where(and(eq(accountSources.organizationId, organizationId), isNull(accountSources.retiredAt)));
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
      assignment: assignment ? { providerAccountId: assignment.id, memberId: assignment.memberId, verification: assignment.verification, revision: assignment.revision } : null,
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
