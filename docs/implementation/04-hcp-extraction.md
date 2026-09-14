# Move product policy out of HCP

**Status: HCP removal in progress; app-side relocation not started.** Do not import the management package into the new app as an intermediate permanent architecture. Its source remains available at the tagged baseline commit below.

## Source baseline and evidence

Reviewed source: [HCP commit 68a1afc](https://github.com/qazisaad/harness-control-protocol/commit/68a1afcd0cbe44da73d89474245fd7c931bb3d27), local checkout `/Users/qazisaad/Prolution/t3_p2a_exploration/hcp-runner`. That local path is research provenance only, never a build dependency. Source paths in the following table are relative to that commit; destination paths are proposed in this app.

The HCP tree at that commit contained four coordinated 0.4.0 package manifests and a private account dashboard. Registry checks on 2026-09-13 and again on 2026-09-14 returned protocol, SDK and runner at `0.3.0` and management E404; `origin/main` had no commits after the baseline. The only management consumers were inside the HCP repository itself: the account demo, `examples/public-sdk.mjs`, `scripts/check-release.mjs`, the root tsconfig and documentation. No private consumer or tarball installation is known.

Decision (2026-09-14): management is removed from HCP before the 0.4.0 release, so no version of `@harness-control/management` is ever published and no deprecation path is needed. The 0.4.0 release therefore ships three packages: protocol, SDK and runner. A released account-capable core version remains a prerequisite for the public app clean-install gate. Never remove a published package version from npm as a migration mechanism.

## Exact move/keep inventory

| HCP source | Destination/decision | Treatment |
| --- | --- | --- |
| `packages/hcp-management/src/policy.ts` | `src/server/capacity/policy.ts` | Move threshold, quote and renewal policy; split by responsibility only if needed; canonical rules live here |
| `packages/hcp-management/src/spend-policy.ts` | `src/server/billing/spend-policy.ts` | Move exact-money cap-increase decision logic; bind budgets to our transactional exposure model |
| `packages/hcp-management/src/claude-admin.ts` | `src/server/billing/claude-enterprise.ts` | Move adapter, disabled by default; verify API and organization binding before enabling |
| `packages/hcp-management/src/actions.ts` | `src/server/actions/` | Adapt action schemas and recovery logic to org authority, persisted attempts and PostgreSQL reservations; do not blindly preserve file-store assumptions |
| `packages/hcp-management/src/node.ts` | No production counterpart | Replace JSON action/file stores with PostgreSQL repositories; optional one-shot migration reader only if a real user needs it |
| `packages/hcp-management/src/policy.test.ts` | Capacity/billing unit tests | Preserve behavior tests, adapt money normalization and product contract deliberately |
| `packages/hcp-management/src/actions.test.ts` | Adapter contract and action integration tests | Keep lost-response/wire fixtures; add real PostgreSQL concurrency/crash tests |
| `packages/hcp-management/src/index.ts` | Remove upstream package barrel | No new public app library; import reducer directly from protocol, never relocate it |
| `packages/hcp-management/package.json`, README, LICENSE, tsconfig | Remove future upstream package build/release participation after gates | Preserve license/provenance with moved code; update documentation and release scripts |
| `demo/accounts/public/` | Reference for new app UI | Reimplement in TanStack routes/components; do not carry the whole local dashboard or token-fragment authentication |
| `demo/accounts/src/server.ts`, `index.ts`, tests | Integration reference | Reuse verified flow concepts; move billing-dependent scenarios into app acceptance; retain a minimal upstream read-only account example |
| `packages/hcp-protocol/src/accounts.ts` and its fixtures/tests/schema exports | **Keep in HCP** | General account observation, freshness and reduction contract |
| `packages/hcp-sdk/src/accounts.test.ts`, account commands/connection/reducer exports | **Keep in HCP** | General typed requests, correlation and connection behavior |
| `packages/hcp-runner/src/accounts/`, `account_usage` config and CLI | **Keep in HCP** | Provider collectors, local opt-in, normalization, timeout/concurrency and independent reads |
| HCP pairing, connection, existing session/workspace/MCP code | **Keep in HCP** | Independent harness functionality; app exposes only monitoring subset |

## Changes required during relocation

1. Normalize monetary values at the adapter/API boundary into exact minor-unit strings/decimals. The existing general quote policy uses JS safe integers while the spend adapter uses strings. Choose one application contract; do not spread both conventions through callers.
2. Persist authorization revisions, reservation ownership and effect-attempt state in PostgreSQL. The current process-local counter and lifetime file lock are not the new app's execution contract.
3. Treat unknown outcomes as durable locks/exposure, not retryable failures. The imported helper cannot establish non-application solely by failing to read desired state.
4. Map an app account to a verified provider member/organization before using the adapter. A runner account hash or locally configured scope is insufficient.
5. Keep the Claude adapter tied to its real capability: monthly credit-spending limits. Do not rename it to subscription upgrade or build fictional Codex billing methods for symmetry.
6. Retain HCP's canonical reducer. UI projections, DB history and policies must consume it without cloning it.
7. Keep automated writes off until the live connector gate passes. Tests and reference code do not establish production billing readiness.

## Migration and release sequence

A. Inventory the latest HCP tree, package registry and known consumers. Record the source commit, licenses/notices and API usage. Check the new app dependency graph has no management, file/link, git-submodule or sibling-checkout import.

B. Relocate the app-owned code with its tests and provenance from the tagged baseline commit. Adapt it to the contract here. HCP is not a shared source of truth: fixes to app policy land here only.

C. Build the application's PostgreSQL and tenant integration, and prove policy/administration recovery against fixtures. No app runtime import of `@harness-control/management` is allowed. Do not copy installed dependencies, native credentials, node_modules, compiled output, local JSON ledgers or observed user data.

D. Remove management from HCP in one change, before the 0.4.0 release. Delete the package, and reduce the account demo to connecting, reading and rendering normalized capacity: remove policy, quote, budget and renewal UI, the settings endpoint and the management dependency. The demo keeps its state in memory only; the `ExclusiveJsonFile` store leaves with the package and the demo drops its state-file option, because a reconnecting runner re-reads accounts and the demo has no policy left to persist. Adjust `examples/public-sdk.mjs` to assert account reads/reduction without a management decision. Update workspace references, lockfile, root README, `docs/account-capacity.md`, `docs/public-packages.md`, `docs/release.md` and `scripts/check-release.mjs` to three packages. Search the entire tracked tree for stale management imports and public claims. The observation protocol remains compatible; no new billing messages are introduced.

E. Validate both repositories independently from clean environments. HCP still reads native accounts without the app; the app builds and tests without an HCP checkout. Release-install acceptance uses exact public versions of protocol/SDK and separately installed runner. Only after this passes may the old source/package path be considered removed.

## Existing data and rollback

No production app database exists at this baseline. Do not build a general import framework speculatively. If a real HCP-demo/action-ledger user is found, add a narrowly scoped one-shot migration: operator selects target organization/member mapping, sources stay explicitly historical until refreshed, unknown/pending actions keep reservations/locks, and no provider write occurs during import. Imported secrets require explicit reconfiguration, not copying runner homes.

The validated upstream baseline is HCP commit `68a1afc`, tagged as `management-baseline-0.4.0` before removal. That tag and removal commit e6b5040 were pushed to HCP origin/main on 2026-09-14, so the moved source is addressable. Record app provenance against that tag. Rollback deploys a compatible app/database snapshot with writes disabled; restore code independently of data where possible. Never replay provider writes from restored jobs. Do not roll back to a stale ledger and assume its unapplied actions are safe. Preserve the last committed financial evidence and reconcile provider state first.

## Exit criteria

- HCP remains useful to an unrelated builder with protocol/SDK/runner only.
- Account monitoring tests and public package install tests pass after management removal.
- Capacity Console's policy has one owner here and no runtime dependency on upstream management or the other private projects.
- HCP docs describe observation capabilities, not a promised organization billing product.
- License headers/notices and a provenance entry name the moved source commit and changed behavior.
- Any public API removal has a documented consumer/release path; live administration status remains accurately labelled.
