# Work report

Maintained implementation and review record. The current status and open findings below supersede the original implementation claims retained in the historical section. Review date: 2026-09-14.

## Current assessment

The monitoring path works through a real browser, public HCP runner, signed-in Codex account, WebSocket and PostgreSQL. It is a development preview, not yet a release-ready organization product. The original statement that everything remaining needs the owner was incorrect: identity, offboarding, admission controls and retention need application work.

| Area | Reviewed state |
| --- | --- |
| HCP extraction | Release validation passed independently. Commit e6b5040 fast-forwarded and pushed to origin/main; annotated management-baseline-0.4.0 tag pushed, pointing to 68a1afc. Local merged branch removed. |
| HCP npm release | Blocked: npm whoami against registry.npmjs.org returns E401. Protocol, SDK and runner 0.4.0 remain vendored with checksums until publication. No registry dependency switch was made. |
| Gate 1 | Production runtime, bootstrap and database verified; identity/recovery contract still incomplete. Do not mark the whole gate done. |
| Gate 2 | Browser bootstrap → organization → member invitation/redemption → machine approval → real Codex observation → account history verified. Access and persistence fixes pass regressions. Offboarding, retention and other findings below remain. |
| Gate 3 | Pure policy and exact minor-unit money code relocated; billing contexts, quotes, proposals and renewal UI remain unimplemented. |
| Gate 4 | Durable authorization/action/recovery services unimplemented; live connector stays disabled. |
| Gate 5 | Fresh source copy without node_modules or local state built and ran with a new Compose project/volume; restart preserved installation state. Separate PostgreSQL backup/restore passed. No separate clean physical machine or cross-version upgrade tested. |
| App Git | Reviewed changes remain on implement-monitoring. No remote is configured. Recommend a draft PR after the owner names the GitHub destination. |

## Fixes made during review

- **Member data isolation:** filter source rows by the authenticated member before the canonical reducer groups accounts. Previously, sharing an account key with another member exposed that member's sources, newer quota and history. Restrict overview member data and redact another member's assignment id. Regression uses the same account on two members' machines with different observations.
- **Durable generation fencing:** lock and validate the current runner generation/revocation in the same database transaction that rebuilds canonical source state and persists a snapshot. Ignore older/equal observations before updating provider-account metadata/history. In-memory socket checks alone did not protect against database races.
- **Connection/revocation races:** serialize generation allocation, reject stale attachment, recheck authority before reads and compare-and-set the expected generation during revocation.
- **Atomic bootstrap and organization creation:** bind Better Auth's adapter to the surrounding transaction. Injected audit failures now roll back the auth user/session or organization/membership/policy together with the app operation.
- **Auth endpoint boundary:** public organization mutations must pass through app services. Raw Better Auth organization endpoints previously bypassed policy seeding and audit boundaries. Session/sign-in/sign-out remain available; public sign-up remains closed.
- **Lease recovery:** losing the lease fences sockets without permanently closing the WebSocket listener. A real runner reconnects and persists a fresh read after reacquisition in integration tests.
- **Setup:** generated local database settings now match the supplied dev database; Compose receives one generated password shared by app and database. Repeated setup preserves configuration, including optional rotation keys. The dev database script starts existing stopped containers rather than deleting them. README uses Node env-file loading.
- **Invitation navigation:** signed-out existing users get a sign-in link returning to the invitation. Login return paths reject protocol-relative and backslash forms.
- **Test reliability:** the concurrent-bootstrap test signs in as the actual winner rather than assuming the first request wins.

## Review evidence

| Check | Independent result |
| --- | --- |
| Typecheck and production build | Passed |
| Unit tests | 9 passed |
| Integration tests | 11 passed, 20 total tests across 5 files; dedicated PostgreSQL review database |
| New rollback tests | Audit failure leaves no bootstrap user/session; organization failure leaves no organization/membership; retry succeeds |
| New isolation/persistence tests | Same provider account across members stays private; stale generation, revocation and older snapshot cannot overwrite stored reading |
| Lease recovery test | Competing lease fences the real WebSocket; reacquire → public runner reconnect → refresh persists successfully |
| Browser | Bootstrap, organization creation, invite creation/redemption, member role, real machine approval, dashboard, account detail/history and refresh inspected; screenshots viewed in review session; temporary real runner revoked through UI |
| Native provider | Vendored public hcp-runner 0.4.0 connect against the app with explicit local Codex account-usage opt-in; signed-in provider quota, plan and reset rendered. No fixture collector, prompts or provider writes in this manual scenario. |
| HCP reduced demo | Opened in browser; connected native Codex read, quota/reset/freshness shown; Claude sharing disabled and labelled. No management policy or billing UI. |
| HCP release check | Passed full release:check, including pack, clean install and public SDK acceptance over WebSocket |
| Compose | Fresh source copy, isolated project capacity-review-clean, new PostgreSQL volume, production image built, migration exited successfully, readiness 200, app restart preserved installation row |
| Backup/restore | Custom-format dump of actual review database restored to separate empty PostgreSQL 17 database: 1 organization, 2 members, 1 runner, 4 history rows. Restored production app ready after copied lease expiry. Private backup and keys excluded from Git. |
| Setup repetition | Generated configuration unchanged on repeat; a separate dev container retained a marker row across stop → setup → restart |
| Production dependency audit | 4 moderate reports through Better Auth's optional drizzle-kit peer → esbuild tooling; no high/critical. No esbuild development server is used by production. Remove unnecessary tooling or resolve upstream chain before release; do not apply the suggested breaking downgrade blindly. |

Automated provider scenarios still use labelled fixture collectors. The separate manual Codex scenario supplies real-provider evidence, not automated cross-provider coverage. Docker's saved credential helper stalled the initial build; an isolated empty Docker auth config allowed the public base-image download. The user's Docker login was unchanged.

## Open review findings, in priority order

1. **Identity contract is unmet (release blocker).** auth/auth.ts disables email verification; redeemInvitation creates a user/session using the invitation alone. This contradicts implementation/03-behavior-and-recovery.md. Add independent invitee authentication and operator recovery, or explicitly revise the product contract after a reviewed identity decision. SMTP env variables currently do nothing. Invitation creation/redemption/acceptance also need transactional audit coverage and cancellation/expiry race tests; existing-user acceptance currently has no audit event.
2. **Offboarding is missing (release blocker).** There is runner revocation, but no complete app-owned member removal/role-change/session revocation/runner fencing workflow. Raw auth mutation routes are now blocked, so they must not be treated as a replacement for this workflow. Include last-owner protection and active-session/running-socket tests.
3. **Public admission and runtime enforcement are incomplete.** Pairing routes have no rate limits, request bodies are fully read before the size check, pending records accumulate, and sockets have no demonstrated hello/liveness admission bounds. Readiness/WS honor the lease, but a process without it still serves browser mutation handlers. Close these before public multi-user deployment; singleton readiness alone is not enforcement for HTTP mutations.
4. **Monitoring lifecycle gaps.** Retention deletion, explicit source retirement and assignment-conflict derivation are absent. Revoked sources retain readings but account pages do not clearly show the source's revoked/disconnected state; a recent historical reading can still be labelled fresh. Add separate connection-status disclosure without fabricating HCP observations. The schema lacks the composite organization foreign keys promised by the contract.
5. **Test coverage is narrower than the original report.** The original matching-proof redelivery test actually tested a wrong proof; correct same-proof retry still needs an explicit assertion. Role changes, offboarding, source account switches and real Claude reads have not been verified. The test suite resets its target schema, so only use a disposable test database.
6. **Release and deployment gaps.** App remote/CI/PR unavailable until a destination is supplied. npm publication pending. Separate-machine install, tested TLS/proxy example and cross-version upgrade remain open. Dev tooling's moderate audit chain should be removed from the production install. HCP connect still mentions P2A in generic pairing output, a wording cleanup for a subsequent HCP change.

These findings are application/release work, not reasons to put organization policy back into HCP.

## Needs the owner

- Authenticate npm CLI with publish access to @harness-control, then confirm readiness. Publishing was attempted only as an authentication preflight and failed E401; no package was published.
- Name the app's GitHub owner/repository and visibility. No app code has been pushed or merged; a draft PR is recommended while blockers remain.
- Provide a separate clean deployment host for final gate 5 acceptance if that specific guarantee is required.
- Later, provide the documented Claude Enterprise test organization/member/admin-key reference and explicit allowed live test change. These inputs are needed only for live connector validation, not for writing the remaining application services.

## Next implementation order

1. Resolve identity/recovery and offboarding; finish admission, lifecycle and isolation contracts with regression tests. Keep billing writes disabled.
2. Publish HCP 0.4.0, replace all three vendored file dependencies with exact registry versions, regenerate lockfile and rerun clean-install/integration validation.
3. Complete gate 3 billing contexts, quotes and proposals; then gate 4 durable authorization, reservations and reconciliation.
4. Establish app CI/draft PR, repeat deployment acceptance on a separate clean host, and validate upgrades before calling this release-ready.

## Historical implementation record

The sections below preserve the original agent's evidence and choices. Any broader completion claim is superseded by the reviewed status above.

### 2026-09-14: App gates 1 and 2 implemented and verified

Runtime composition (gate 1 spike, proved with the production build, not the dev server):

- `vite build` emits `dist/client` and one `dist/server/server.js` whose default export is the TanStack Start fetch handler. A custom server entry (`src/server.ts`) also exports `createRuntime`, so the WebSocket gateway, lease and background loop ship in the same bundle.
- `server/index.mjs` is plain Node: static assets from `dist/client`, everything else through the fetch handler, `/runner` upgrades to the gateway, SIGTERM closes sockets, releases the lease and exits. Verified with curl and `ws`: pages render server-side, redirects to `/bootstrap` while bootstrap is open, `/health/live` and `/health/ready` (database, schema version, configuration, lease), unauthorized upgrade rejected with 401, a second process gets `ready:false` with `lease:false` and 503.
- Better Auth 1.7.4 with the Drizzle adapter, organization plugin (roles owner/admin/member/auditor registered through access control), TanStack Start cookies, telemetry disabled, trusted origin from `APP_ORIGIN`. Public sign-up is blocked by a before-hook unless the caller carries a per-process internal marker; only bootstrap and invitation redemption set it.
- PostgreSQL schema in `src/server/db/schema.ts` (auth tables generated by the Better Auth CLI plus installation, pairing_requests, runners, account_sources, observation_history, provider_accounts, capacity_policies, audit_events, runtime_lease). Versioned Drizzle migration in `drizzle/`; `server/migrate.mjs` runs under `pg_advisory_lock`; readiness compares the applied migration timestamp with the journal bundled into the build.
- Secrets: AES-256-GCM with key id and associated data (`src/server/secrets.ts`); credential digests for runner secrets; encrypted pairing delivery envelope purged at expiry.

Monitoring (gate 2):

- Pairing routes at the origin root exactly as the runner expects; browser approval binds a request to the approving member's organization (owners/admins may enrol for a named member, audited separately); connection tokens are single-use and 60s; the token request checks credential digest, identity, protocol version and the installed protocol schema hash.
- Gateway: authentication before HCP acceptance, hello identity match, per-socket connection generation with fencing of replaced sockets, coalesced reads, persistence only for the current generation. Ingestion applies the canonical `HcpAccountUsageReducer`, upserts per-source state, appends history, upserts provider accounts without touching assignment.
- Organization projection rebuilds the reducer from stored sources namespaced by runner row, so shared hostnames cannot collide and the same account on several machines is one account.
- Policy revisions (immutable, one active, `expectedRevision` conflict), account assignment with verification and revision conflict, runner revocation with generation check and socket fencing, audit events in the same transaction as their change.
- UI: bootstrap, login, invitation redemption, organization creation, authenticated layout, overview (15s polling), people and machines (invite links, refresh, revoke), pairing approval, account detail with history and policy explanation, policies with revision history, audit, settings.

Verification evidence (all run on 2026-09-14 against PostgreSQL 17 in Docker):

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| Unit tests (`tests/unit`) | 9 pass: relocated policy, spend and action tests plus the string-money contract |
| Integration `identity.test.ts` | 4 pass: closed sign-up 403; two simultaneous bootstraps create one admin and the token stays consumed; org creation seeds policy revision 1; invitation redeemed by a new user; role checks; cross-org selection refused |
| Integration `hcp-flow.test.ts` | 3 pass with the real `@harness-control/runner` 0.4.0: pairing via `pairWithReferenceControlPlane`, credential redelivery only to the matching exchange proof, approval by a member of another org binds to that org only; connected runner reads fixture accounts over a real WebSocket, two provider instances of one scoped account project as one account (not summed), tenant isolation on read/refresh/revoke/assign, assignment revision conflict, coalesced manual refresh, revocation fences the live socket and blocks token issuance, history retained; failing reads keep last-good data as `unavailable` without leaking the provider error; runtime restart rehydrates from PostgreSQL and the reconnecting runner produces a fresh read |
| Production smoke (curl, ws) | listed above under runtime composition |
| `node scripts/check-docs.mjs` | 11 files, 23 links OK |
| `docker build` | image `capacity-console:dev` built from a clean context, 99 MB |
| `docker compose up` (project `cctest`, published port 3470) | migrate container exited 0, app `/health/ready` 200 with lease held, `/` redirects to `/bootstrap`, `POST /pairing-codes` accepted, `docker compose restart app` came back ready and the pairing row survived; stack torn down with volumes |

Injected provider data in the integration scenario is fixture data and is labelled as such in the test file.

### 2026-09-14: HCP management package removed before release

- Branch `remove-management`, commit e6b5040, in the HCP checkout. Package deleted; workspace, tsconfig, lockfile, release check and publish scripts cover three packages. Account demo reduced to connect, read, reduce, render with in-memory state. Public SDK example asserts the canonical projection. Docs updated.
- Verification: `tsc -b` clean; 180 workspace tests pass; `release:check` packed and clean-installed three 0.4.0 tarballs and ran the public SDK acceptance; `npm audit --omit=dev` 0 vulnerabilities.

### 2026-09-14: Plan changes

- `docs/implementation/04-hcp-extraction.md`: registry recheck recorded, removal-before-release decision resolved, steps D and E merged, demo persistence decision recorded, baseline tag named.
- `docs/implementation/05-delivery-and-validation.md`: gaps entry updated.

## Decisions taken during implementation

- Exact-version pins; TypeScript 5.9.3 instead of the 7.x alias used by TanStack examples; Vitest 5 with `unit` and `integration` projects.
- HCP packages consumed as vendored release tarballs until published (documented deviation; see Needs you 1).
- App-wide money contract: exact minor-unit decimal strings compared as BigInt. The relocated quote policy was adapted accordingly; this is the one behavior change recorded in `docs/PROVENANCE.md`.
- Connection tokens are held in process memory. This is consistent with the one-process deployment; a restart between token issue and connect makes the runner request a new token.
- Organization creation is allowed for any signed-in user (they become owner). Membership elsewhere remains invitation-only.
- The runner endpoint and pairing URLs derive from `APP_ORIGIN`, never from request headers. Runners must be given that exact origin; the runner compares it.
- The account demo in HCP keeps state in memory only.
