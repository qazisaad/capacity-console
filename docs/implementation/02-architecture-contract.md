# Architecture, data and authority

This document owns component, data and API boundaries. [Behavior and recovery](03-behavior-and-recovery.md) owns transitions. [HCP extraction](04-hcp-extraction.md) owns upstream changes.

## Runtime and dependencies

Use TypeScript end to end, TanStack Start with React and Vite, Tailwind/shadcn components, TanStack Query for bounded refresh and Table where tabular filtering needs it, PostgreSQL with Drizzle migrations, Better Auth with its organization plugin, and Node.js with `ws`. Resolve compatible supported versions during the runtime spike, pin the Node LTS/container major and lock dependencies. Use npm with a committed lockfile and `npm ci` for the initial repository; a workspace framework is unnecessary.

The production composition is one Node app process hosting HTTP, the HCP upgrade path, and background recovery, plus PostgreSQL. A Node server delegates ordinary HTTP requests to the supported TanStack Start production handler and handles `/runner` upgrades separately. Prove that composition against the selected build output. Do not assume the Vite development server proves production WebSocket behavior. A framework adapter needed for this composition belongs here, not in HCP.

UI refresh uses authenticated ordinary HTTP polling with TanStack Query initially. HCP WebSockets are machine-to-server transport, not the browser's database connection. No Redis, Convex, WorkOS, Python backend or required external job service. Native provider collectors run on employee machines, never inside the hosted app with an employee's login.

The app depends on exact released versions of `@harness-control/protocol` and `@harness-control/sdk`. The runner is separately installed. The new app does not import HCP source paths or require its checkout. A release artifact may be used in a development acceptance test with recorded checksum; a public clean-clone release must resolve all dependencies independently.

## Ownership and layout

Proposed layout, to be created during implementation:

```text
src/routes/                  UI routes and thin server boundaries
src/server/auth/             Better Auth integration and request identity
src/server/db/               Schema, migrations and transactional repositories
src/server/hcp/              Pairing, connection authentication, account ingestion
src/server/capacity/         App-owned policy, quote and renewal evaluation
src/server/billing/          Provider adapters and administrative action service
src/server/actions/          Transactional approval, reservation and recovery
src/components/              UI components; no independent business policy
server/                      Node HTTP/WebSocket startup and lifecycle
```

One canonical definition per business rule. Validate incoming JSON once into typed objects; use discriminated unions for states/actions. Database constraints enforce ownership and concurrency invariants. Use HCP's canonical reducer, not a second interpretation of its snapshots in React or SQL. Database and browser projections are derived, not separately editable.

## Durable data

All application tables below have an internal id and organization id except installation/pairing records before approval. Foreign references must preserve organization id using composite constraints where applicable; every request still needs server authorization. JSON blobs are versioned and validated at read/write boundaries. Avoid storing arbitrary raw provider payloads.

| Entity | Durable owner and key invariants |
| --- | --- |
| Auth users, sessions, organizations, memberships, invitations | Better Auth schema; member id is the employee identity in this product, no duplicate employee directory |
| Installation state | Single row; bootstrap consumed once; no public route can reset it |
| Pairing requests | Request id, runner/host identity, exchange-secret hash, expiry, approval member/org, credential delivery state; unapproved rows cannot access tenant data |
| Runners | Organization/member binding, runner and host ids, credential digest, revocation, connection generation and last seen; unique installation identity within org |
| Provider accounts | Unique `(org_id, provider, account_key)`; assignment to active member or explicitly unassigned; verification status and revision; optional verified connector/provider-member binding |
| Account sources | Unique `(org_id, runner_id, provider_instance_id)`; HCP source state including latest/last-success, receive time; points to the currently observed account when available |
| Observation history | Append-only validated samples keyed by source and observation time; bounded retention; records are history, not an alternative writable current state |
| Capacity policies | One active revision per org; immutable prior revisions, thresholds, grace, freshness, approval mode and currency/ceiling settings |
| Billing contexts | Account contract revision, quotes, baseline forecast and actual billing-period boundaries; provenance and verification; edits invalidate unexecuted decisions |
| Provider connections | Org-owned connector identity and encrypted admin secret, key version, capability/live-verification state; never returned to browsers |
| Budget periods | Unique org/currency/period identity; finite authorized ceiling and revision; row lock serializes new exposure reservations |
| Actions | Logical identity, immutable decision inputs, expected state, desired operation, authorization, reservation amount/status, execution state, timestamps, lease/attempt generation and evidence |
| Audit events | Org-scoped append-only events written in the same transaction as changes they describe; redact secrets, no general request-body logging |

Use PostgreSQL integer/decimal representations and integer minor-unit strings at JSON boundaries for money. Currency accompanies every amount. Normalize legacy JS-number money only if it is a safe integer. Preserve provider fractional spending as exact decimals; do not round down before a threshold or reservation comparison. Do not convert currencies implicitly.

An action row owns its reservation; do not introduce a separately writable remaining-budget projection. Under the locked budget-period row, derive available incremental exposure from its ceiling and held/committed action reservations. Existing provider spending outside this app must be reconciled separately: the app cannot guarantee the provider's organization-wide invoice ceiling from local reservations alone.

## Identity and authorization

Use Better Auth server sessions and membership checks. Standard app roles: owner, admin, member, auditor. Owner manages roles, connectors and finite automatic-spend grants; admin manages membership, account assignments and recommendations and approves within owner-granted bounds; member sees/revokes their own runners and readings; auditor has organization read access excluding secrets. No role is implied by an email domain or client-supplied organization id. Ownership transfer must preserve an active owner.

Select the active organization in the session/UI; resolve every object under that authorized organization server-side. Recheck current membership, role and policy on approval and immediately before provider execution. UI hiding is not authorization. Installation bootstrap grants no permanent tenant-bypass API.

HCP account keys are pseudonymous identifiers, not proofs of employee ownership or of billing organization. Namespace by organization before deduplication. No cross-tenant merge. A local-only key cannot be merged across machines automatically. Operator-asserted scopes require admin confirmation before financial association. A changed provider login creates/links a different account; never inherit the previous account's approval or provider-member mapping.

Secrets: use authenticated encryption for provider keys with a persistent deployment key and key id; bind organization/connection identity as associated data. Retain runner credential digests rather than raw long-lived secrets, except a short-lived encrypted pairing delivery envelope needed for retry. Require trusted origins, secure cookies on public deployments and anti-CSRF handling on browser mutations. Never log credentials, invitation/reset tokens, provider transcripts or complete auth request bodies.

## Boundary contracts

Browser payloads use versioned validators. Read endpoints return explicit view DTOs, pagination cursors and server-derived permissions, never database rows with secrets. Policy and billing edits carry `expectedRevision`; a mismatch produces a conflict and requires refresh. No omission deletion: patches change only supplied fields; deletion is an explicit operation.

| Operation | Input and outcome |
| --- | --- |
| Update policy | `{organizationId, expectedRevision, policy}` → validated new revision; owner authority required for automatic-spend grant changes |
| Assign account | `{accountId, expectedRevision, memberId, billingBinding?}` → verified assignment revision after org/provider checks; no name/email guess |
| Refresh runner | `{runnerId}` → read-request identity/status; coalesced and bounded; a matching persisted snapshot completes it |
| Approve recommendation | `{actionId, expectedRevision}` → server-created grant and transactionally reserved action or explicit budget/conflict rejection; client supplies no trusted amount |
| Cancel action | `{actionId, expectedRevision}` → cancellation only before an effect attempt; an executing/unknown action requires reconciliation |
| Reconcile action | `{actionId}` → queued read-only reconciliation under current authority; no implicit rewrite |
| Revoke runner | `{runnerId, expectedRevision}` → credential revocation and socket fencing; omission from a snapshot does not revoke |

HCP pairing endpoint payloads use exported schemas: `/pairing-codes`, `/pairing-exchange`, `/runner-connection-token`. The browser approval endpoint is app-owned and resolves the request id to stored identity; the runner never chooses its organization/member in an unauthenticated payload. These names match the inspected runner pairing implementation; verify them again against the pinned release in the first integration test.

For account reads, use `readAccounts({provider_instance_ids?})`. Accept only a correlated snapshot for the authenticated hello identity/current connection generation. Persist `(org_id, runner_id, provider_instance_id)` source states using the canonical reducer. Persist read request status in memory for monitoring only; a lost read can be repeated without a durable action ledger. Billing commands never travel over HCP or to employee machines.

## Complexity ledger

One app service and one PostgreSQL dependency; no mandatory hosted service. One background loop with a database-owned singleton lease combines due reads, decisions, action dispatch, expiry and read-only recovery. One existing HCP protocol plus app HTTP routes and provider HTTP integration; no new inter-service protocol.

Twelve application entities in the table above, plus the auth library's tables. Actions also own reservations and due work, avoiding separate jobs/approvals/reservations tables. Pairing, runner/source lifecycle and administrative actions each have explicit state transitions; policy evaluation is pure. Each added entity either establishes identity/authority, preserves financial decisions, protects retries, or supplies requested history. Add no generic workflow engine or provider plugin system before a second concrete implementation requires it.

The singleton process/lease is deliberate. It prevents competing gateways and workers in the supported deployment. Multi-replica support requires a separate design for socket routing and execution fencing; a reverse proxy with two replicas is not an implicitly supported deployment.

## Sources and verification boundary

TanStack Start documents Node/Docker hosting; its exact production-handler/WebSocket composition here is a required spike, not verified merely by that support statement. [TanStack hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting).

Better Auth provides organization memberships, invitations, roles and teams. Our spending authorization and server isolation remain application responsibilities. [Better Auth organizations](https://better-auth.com/docs/plugins/organization).
