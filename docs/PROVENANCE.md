# Provenance of relocated code

Code moved from the Harness Control Protocol repository (Apache-2.0, Copyright 2026 qazisaad) keeps its license and this record. Source commit: `68a1afcd0cbe44da73d89474245fd7c931bb3d27`, tagged `management-baseline-0.4.0` in that repository. The management package was removed there before any 0.4.0 release and was never published.

| Destination | Source | Behavior changes |
| --- | --- | --- |
| `src/server/capacity/policy.ts` | `packages/hcp-management/src/policy.ts` | Money fields are exact minor-unit decimal strings compared as BigInt; JS numbers are rejected |
| `src/server/billing/spend-policy.ts` | `packages/hcp-management/src/spend-policy.ts` | None (import path) |
| `src/server/billing/claude-enterprise.ts` | `packages/hcp-management/src/claude-admin.ts` | None (import path); writes disabled by default and gated |
| `src/server/actions/spend-limit.ts` | `packages/hcp-management/src/actions.ts` | None yet; PostgreSQL attempt ownership replaces the process-local counter in gate 4 |
| `tests/unit/policy.test.ts` | `packages/hcp-management/src/policy.test.ts` | Ported to Vitest; money literals are strings; one added test for the string contract |
| `tests/unit/spend-limit-actions.test.ts` | `packages/hcp-management/src/actions.test.ts` | Ported to Vitest; JSON file store replaced by an in-memory store with identical claim semantics |

Not relocated: `node.ts` (`ExclusiveJsonFile`, `JsonSpendLimitActionStore`) and `index.ts`. The HCP account demo UI is reimplemented, not copied.
