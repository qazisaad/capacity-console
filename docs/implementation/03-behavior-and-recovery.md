# Behavior and recovery

This document owns lifecycle semantics. All org/member/resource references are subject to the authority contract in [architecture](02-architecture-contract.md).

## Bootstrap, invitations and runner enrollment

The initial operator supplies a generated bootstrap secret through local setup. Its hash and single-use state protect first-admin creation transactionally; two requests cannot create two installation owners. Bind local setup to loopback by default. Disable bootstrap after consumption, including on app restart. Account creation is invitation-only after bootstrap. A copied invitation is expiring, single-use and bound to the intended identity; redeeming it requires authenticating that identity. Do not permit session creation solely from possession of a membership invitation.

The runner starts the HCP pairing flow with host/runner identity and an exchange-secret hash. The server creates a bounded expiring pairing request. An authenticated member approves it for themselves in the selected organization; an administrator can enroll on a member's behalf only through an explicit audited operation naming that member. Approval must not be possible with the short human-readable code alone. Match stored request identity and exchange proof before returning credentials.

Persist the approved runner binding and credential digest atomically. Keep the exact approved credential response encrypted until pairing expiry so a lost response can be redelivered to the same exchange proof; do not issue a second credential on retry. Purge this delivery envelope at expiry. HCP's current credential includes an MCP proof secret; issue a random unused value for wire compatibility, but this app exposes no harness or MCP operations. The need for a general observation-only credential contract may be proposed separately in HCP, not improvised in this app's wire messages.

Connection-token issuance validates runner proof, host identity, installed protocol/schema compatibility, active member and non-revoked binding. Tokens are short-lived and audience-bound. Match authenticated identity to `host.hello` before accepting. Replacement sockets get a new connection generation; fence all callbacks from the old one and disconnect its SDK instance. Tokens alone never select a tenant. Close active sockets on revocation/offboarding; reject subsequent token issuance. Keep historical observations under retention, labelled disconnected; never silently delete them.

Read only account messages. The server does not expose session start, filesystem actions, shell execution or provider login control, even though the installed HCP runner can support these for other consumers.

## Observation ingestion and ownership

On accepted connection, read opted-in provider accounts without a session. Coalesce manual refresh with an in-flight read; start periodic reads from the scheduler, initially once per minute per connected runner with jitter. Honor upstream collection bounds and SDK timeouts. Store server receive time separately from the provider observation time. Reject malformed envelopes; record sanitized connection/collector failures.

Apply the production `HcpAccountUsageReducer` to persisted source state. A successful source observation replaces that source's full limit list; an explicit empty list remains empty. A failed read updates its latest failure while preserving last-success history. Omitted providers do not delete, disable or clear existing sources. Retire a source only through an explicit authorized action. Ignore out-of-order timestamps according to the reducer; future timestamps do not authorize spending.

Projection is organization-scoped. Use HCP's account key to group observations, not sum percentages. Each window has its own identity/reset. Do not assume a calendar month, a fresh zero after expiry, or an invoice amount from usage percentage. The current HCP reducer may conservatively select unavailable last-success data over older successful data from another source; consume that behavior rather than overriding it in UI code.

Derive source state after transaction commit and publish only committed snapshots. On database failure, show a refresh error, do not advance durable state, and repeat the safe read later. An app restart rehydrates source state before requesting fresh data. Missing configuration or an offline machine produces unavailable/stale state, not a silent fallback reading.

A newly observed account is associated with its source and presented for member/billing assignment confirmation. Same account across different members is an assignment conflict, not evidence that shared credentials are permitted. Preserve all authorized source history but suppress automatic billing until resolved. An account switch detaches the source from the previous current-account projection while retaining history; it does not transfer approvals or billing identity.

## Policies, recommendations and contracts

The initial organization policy uses the inherited HCP reference defaults: 95% threshold, 30-minute reset grace, 300-second maximum observation age and a seven-day renewal review window. These are app defaults, not provider facts. Each edit creates a new immutable policy revision.

For quota decisions, stale/failed/missing/reset-expired data asks for refresh. A reached limit whose reset is within the configured grace asks the user to wait. Otherwise evaluate verified, unexpired quotes covering the exact affected limit windows and currency. No comparable quote or known budget means review. Compare actual all-in incremental charges only; predictions must be labelled. Initially retain the conservative behavior that incomplete required windows block automatic decisions; show which fields are missing rather than retrying a permanently unavailable field forever.

Create a stable decision identity from organization, account, decision kind, relevant window/reset identities, policy revision and billing-context/quote revision. Canonicalize/sort identities before hashing. Persist the full immutable input snapshot and reason. Poll timestamps do not create a new financial action. A later policy/context revision may supersede an unexecuted proposal; it cannot replace an executing or unknown action's identity.

For credit-spending decisions, read authoritative provider spend and current cap directly through the organization connector. This is a separate input from runner quota. Preserve exact decimal amounts and reject currency/binding changes. Verify the provider member is the mapped member in the configured provider organization. Refresh current state immediately before authorization/execution; matching displayed names is insufficient.

A spend-period id is based on verified provider/contract boundaries and timezone, not local calendar arithmetic or a decline in percentage. A cap increase does not buy capacity and the reserved headroom is not a confirmed invoice charge. External administrators can change caps/spend outside this app; display reconciliation time and do not promise a global provider spending guarantee.

## Approval and financial execution

Persist one logical action containing expected provider state, desired operation, account/member/connector binding revisions, policy/context revision, real billing period, expiry and input evidence. Separate a human proposal from the provider action but store their lifecycle on this same row. Represent the action as a discriminated union: finite `set_spend_limit` or explicit `restore_inherited`. Subscription upgrade recommendations have no executable provider operation initially.

States:

```text
proposed → authorized → executing → applied
    │          │           ├─ confirmed no-write → rejected
    │          │           └─ uncertain outcome → unknown
    │          └─ cancelled / expired (only before execution)
    └─ rejected / cancelled / expired
unknown → reconciled desired state → applied
unknown → proved non-application and stopped executor → rejected
unknown → ambiguous → unknown (reservation and account lock retained)
```

Proposal cancellation releases no budget because none was reserved. Authorization is a transaction: lock the org budget-period row, check current member/permissions/policy/context and decision freshness, check no unresolved action owns the provider member, reserve bounded exposure, and transition the action to authorized with an audit event. Repeated approval returns the existing result. Stale revisions or insufficient budget abort the entire transaction.

For a finite increase, reserve at least the positive cap delta; conservatively include any unresolved exposure already held. Never count a cap reduction as a refund or free the period's committed exposure based on it. The budget UI must name this an authorized incremental-exposure budget, separate from actual spend. A null/unlimited baseline cannot support a bounded automatic reservation and requires review. Automatic restore-to-inherited is disabled unless a freshly verified finite inherited limit lies within the owner grant; otherwise require explicit manual review outside the automated path.

The dispatcher claims the action and persists `executing` plus its attempt identity before the provider call. Recheck authorization expiry and current account/connector binding; preflight provider state must match the expected state. Do not hold database transactions across network I/O. The write is followed by a provider read; only a matching result permits `applied`. The audit and reservation transition commit together.

Applied increases change reservation from held to committed for the same period. An unequivocal preflight failure before a write releases held exposure and records rejected. Timeout, process loss, malformed post-write response, database failure after write, or failed confirmation leads to unknown. An action may have succeeded despite an error: never automatically retry its write.

An expired execution lease only permits reconciliation; it does not prove the effect did not happen and does not authorize another write. Recovery reads the provider, keeping the member lock/reservation while uncertain. Never release an unknown action merely because its grant or billing period expired. A provider read showing desired state confirms desired state, not proof that our request caused it; audit wording must reflect that.

The imported single-process service is insufficient as-is for PostgreSQL recovery. Replace process-local execution counters with durable attempt ownership/fencing and prevent settlement racing a live executor. A terminal rejection after uncertainty requires proof that the old executor cannot still write and that the effect did not occur; otherwise retain unknown for operator intervention. Since the provider lacks conditional writes/idempotency guarantees here, do not claim distributed exactly-once behavior.

## Renewal and offboarding

Renewal review uses verified renewal and change-deadline timestamps, current/baseline prices and a supplied forecast. Missing forecast means review. A passed deadline requires contract reconciliation. A new month never automatically deletes accounts, removes paid seats or downgrades subscriptions.

Finite spend-cap restoration uses a new action keyed to the verified new provider period and baseline-policy revision. Check prior unknown actions first. Preserve all historical action identities and audit events. Postpone if any unknown action could still change that member. Do not send `null` to restore: in the implemented Claude contract null means unlimited.

Offboarding revokes sessions/membership access and runner credentials, closes connections, and cancels unexecuted authorized work while releasing its reservations transactionally. Executing/unknown provider actions still need read-only administrative reconciliation under organization authority. Offboarding does not cancel provider subscriptions or erase audit records. Retention/deletion operations are explicit and cannot remove unresolved financial evidence.

## Background loop and operational failures

One database-owned singleton execution lease guards the supported app process. A second active instance fails readiness. Loss of lease/database access stops new provider dispatch and fences stale callbacks; in-flight writes become reconciliation candidates. Graceful shutdown stops dispatch, closes runners and waits a bounded interval before retaining interrupted work as uncertain.

Use due times on the action rows and policy/billing contexts; do not create a generic workflow engine. Retry safe reads with bounded backoff and jitter. One broken connector must not block monitoring of other organizations. Poll only opted-in connected runners; retain explicit freshness when reads are rate-limited.

Secrets and raw provider error bodies are excluded from logs/audit. Health checks distinguish process alive from ready database/schema/lease. Persisted state, not a browser toast or scheduler acknowledgment, proves completion.
