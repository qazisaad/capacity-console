# Delivery and validation

These are ordered implementation gates, not claims of completed application work. The scope/data/recovery contracts take precedence over convenient shortcuts in a milestone. Do not create dozens of speculative tickets before the runtime gate resolves the production integration.

## 1. Prove the independent runtime and establish app-owned policy

Create a minimal TanStack Start production build with Better Auth organization membership and PostgreSQL/Drizzle. Prove an HTTP login and an authenticated `ws` connection through the same Node server; verify graceful shutdown and restart. Pin compatible dependencies and document the actual start command. Inspect the current HCP public release situation and start the code extraction using [the extraction plan](04-hcp-extraction.md).

Acceptance: a fresh external clone builds from its lockfile, without P2A/Playground/T3/HCP source checkout or SaaS credentials. Production HTTP and WebSocket upgrade work. Database schema migration is repeatable and first-admin bootstrap is single-use under concurrent requests. An unauthorized socket is rejected before HCP acceptance. The selected Node adapter is established by working code, not an assumption about the development server.

Gate: if one-process production composition fails, record the exact evidence and revise architecture before implementing UI. Do not silently add a service or cloud dependency. Identity and session isolation must use the selected auth library's supported integration.

## 2. Ship organization monitoring end to end

Implement invitations, roles, pairing/token exchange, runner revocation, account-source ingestion/reduction, account assignment and the overview/detail screens. Add the singleton lease and bounded read loop. Implement current-state/history persistence and configured retention.

Acceptance: a member can pair their own runner, opt into reads, and see a real normalized observation persisted and rendered. An admin can view authorized members. A different organization cannot read, associate, revoke or refresh those resources. Account switch, duplicate sources, reconnect and unavailable data behave exactly as the reducer contract requires. Restart restores identity/history, recalculates freshness, and obtains a new read.

An injected provider scenario is required in CI and labelled as such. A separate read-only native test records installed provider versions, authentication mode and availability; unavailable Claude data is a valid observed outcome, never replaced by fixture data on the production page.

## 3. Ship capacity and renewal decisions

Finish relocating pure policy/spend logic, implement immutable policy/billing revisions, explicit account billing verification, proposals, actual contract input and in-app decision explanations. Simplify the HCP demo and remove obsolete package participation only after consumer/release gates.

Acceptance: 95% produces the correct refresh/wait/review branch; complete verified quotes are compared in one currency with exact money; missing forecast suppresses renewal advice. Repeated observations do not generate duplicate proposals. Policy/account/context edits invalidate unexecuted stale approvals. Subscription recommendations remain non-executable. Both repositories pass their independent package/build checks.

## 4. Implement authorized effects and recovery

Implement app-owned Claude Enterprise adapter integration, encrypted secret storage, transactional grants/reservations, action attempt claims and read-only recovery. Manual approval is the default; automatic finite-cap policy is owner-enabled only after connector verification. Add verified-period finite baseline restoration; preserve unknown prior actions.

Acceptance: the real PostgreSQL tests below pass. Provider contract fixtures traverse the actual server/action/DB boundaries, including unknown and reconciled terminal states. A designated live test then proves GET → explicitly authorized finite write → read confirmation → authorized restoration → final read. Record grant bounds, ids and sanitized evidence without secrets.

External gate: obtain the organization/member ids, actual period contract, a secret-manager/env reference for the admin key, and explicit allowed test changes before the live scenario. Do not ask the user to paste keys into a task. If absent, complete the monitoring product and fixture-tested code but leave administrative execution disabled and document that gap. Do not claim supported live automation merely because a settings toggle exists.

## 5. Verify self-hosting and release

Implement and test the installation experience in [self-hosting](../self-hosting.md): setup, Compose health, migrations, bootstrap, backups/restoration, encrypted-secret persistence, upgrades and shutdown. Document the exact tested architecture and bounds. Release one app image and retain PostgreSQL as its only required external runtime dependency.

Acceptance: on a clean machine, an operator can start, sign in, create an organization, pair a separately installed public HCP runner, obtain persisted readings and restart without losing state. Test restoring a backup containing unknown actions: provider writes remain paused, no duplicate effect is dispatched, and evidence can be reconciled. License/dependency notices are present and required packages are publicly obtainable without local paths.

## Required scenario matrix

| Scenario | Terminal evidence required |
| --- | --- |
| Tenant A attempts Tenant B ids in every mutation/read | Rejected server-side; no row change, no secrets/observations disclosed |
| Two simultaneous bootstrap requests | One installation administrator; bootstrap stays consumed after restart |
| Lost approved pairing response | Same credential delivered only to matching exchange proof; no duplicate binding |
| Revocation while socket is live | Old socket/generation fenced and future token requests rejected |
| Same account on two machines | One org-scoped account view; percentages not added |
| Login changes on one source | New account identity; old approval/provider-member association not inherited |
| Missing fields, explicit empty success, failure, omitted source | Production reducer semantics preserved through DB and UI |
| Older/future timestamps and reset passed | No stale zero assumption or automatic financial decision |
| Concurrent refresh/reconnect | Matching response only; old connection cannot overwrite current generation |
| Two approvals competing for final budget headroom | One transaction wins or both fit; exposure never over-reserved |
| Repeated approve/dispatch requests | Same logical action and one write attempt; no duplicate reservation |
| Policy, membership or assignment changes before execution | Action denied/expired under current authority; no write |
| Provider applies then response is lost | Unknown action holds exposure; read-only reconciliation, no repeated write |
| Database fails after provider accepts | Recovery retains uncertain ownership; confirmation precedes terminal settlement |
| Worker/app dies in executing state | Lease expiry triggers reads, not a second write |
| Unknown action plus new billing period | Unknown remains visible/locked; rollover cannot authorize conflicting restoration |
| Unlimited inherited cap | Automatic restore denied; never interpret null as default restoration |
| Offboard during provider write | Access revoked, outcome reconciled under org authority; no unearned budget release |
| Wrong key/org/member or provider schema drift | Sanitized failure; connector disabled/unready; no guessed mapping |
| No SMTP/no cloud credentials | Local bootstrap and administrator-managed invitations still usable |
| Backup restore and upgrade | Preserved financial evidence, secrets decrypt correctly, writes explicitly paused until reconciled |

## Verification discipline

Unit tests cover normalization and policy branches. Integration tests use a real PostgreSQL instance with concurrent transactions; mocks cannot establish locking or tenant constraints. WebSocket tests use the installed public HCP SDK and canonical reducer. Browser tests operate actual routes and saved state. Wire fixtures validate provider adapters, with separate live evidence for real administration. Record package versions and commit ids with each release report.

A scenario is end-to-end only when every named real boundary is traversed through its terminal persisted outcome. A queued command, ACK, screenshot, successful mock write, or green unit test does not prove provider-confirmed execution.

## Current gaps and decision status

- App name is provisional; changing it has no architectural impact.
- Production TanStack/Node/WebSocket composition was verified on 2026-09-14. Identity, lifecycle and release acceptance gaps remain in the work report.
- Registry checks on 2026-09-13 and 2026-09-14 returned protocol, SDK and runner `0.3.0` and management E404. Management removal was pushed to HCP main at e6b5040 on 2026-09-14, with the baseline tag. App-side pure policy, spend and adapter relocation is implemented; full decision/action services are not. Publish/verify the three-package account-capable core release before dependency pinning. See [the current review report](../WORK-REPORT.md) for verified gates and release blockers. Development may test recorded release artifacts, but a sibling checkout is never a release requirement.
- Enterprise key, test member, allowed live changes and provider spend-period evidence are not supplied.
- Hosted domain, SMTP and provider credentials are deployment inputs, not prerequisites for writing the local app.
- Horizontal scaling, subscription purchase/account issuance APIs and enterprise SSO are deferred scope, not hidden implementation gaps.

Proceed with gates one and two before enabling effects. Resolve each gate with evidence rather than adding a compatibility flag or dummy integration.
