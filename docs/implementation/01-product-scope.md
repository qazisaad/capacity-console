# Product scope

Status: agreed direction, implementation contract dated 2026-09-13. Runtime integration and provider execution remain gated by the checks in [delivery and validation](05-delivery-and-validation.md). Do not describe the product as implemented because its upstream HCP helpers have tests.

## Purpose and boundaries

Companies should see employees' coding-agent account capacity, recognize approaching limits, and decide whether additional capacity is worth its actual cost. The app must support local evaluation and self-hosting, with the same organization-isolated model usable for a future hosted offering.

HCP is an independent open-source integration project. Changes there require a general harness-control or observation justification. Company spending policy and billing operations belong here, regardless of whether a helper can be made configurable. P2A, Playground and T3 are reference material only; no database sharing, checkout imports, required services or cross-repository application libraries.

## Required user journeys

- An installation operator creates the first administrator through a protected one-time bootstrap, then creates an organization. Additional users join through invitations; public signup is closed by default.
- A member pairs a runner on their own machine and explicitly enables local account-usage sharing. They can see their machines, readings and disclosure scope, and revoke the connection.
- An organization administrator sees account capacity across authorized members, including each independent limit window, observation freshness, unavailable readings and reset times. Existing multiple accounts are represented independently; one account seen on several machines is not counted several times.
- An administrator confirms account-to-member and billing-scope associations. Unverified or ambiguous associations may be monitored but cannot authorize billing.
- An administrator sets versioned policies and actual billing context, sees explanations for decisions, and reviews affected accounts before authorizing a supported action.
- An owner explicitly enables a tested billing connector and finite spending limits. A policy may then authorize supported spend-cap increases automatically within those limits. No generic automatic-upgrade button may imply unsupported operations.
- An auditor can inspect policy changes, approvals, provider-confirmed results and unresolved outcomes without accessing credentials.
- At a real renewal/change deadline, administrators review a baseline-plan recommendation. At a verified spend-period transition, authorized finite spend-cap restoration may execute. These are separate operations.

## Initial screens

| Screen | Required content and operations |
| --- | --- |
| Overview | Accounts needing review, stale/offline sources, remaining authorized exposure, unresolved actions; unknown values stay unknown |
| People and accounts | Memberships, connected machines, provider accounts, assignment verification, revoke/offboard; member sees only their own resources |
| Account detail | Per-window usage, provider/plan labels, observation timestamps, sources and short history, policy explanation |
| Policies and billing | Threshold/reset grace, versioned approval mode, ceilings, actual quotes and contracts, connector readiness |
| Actions and audit | Proposed/authorized/executing/unknown/confirmed outcomes, approver, evidence, cancellation and reconciliation where allowed |
| Organization settings | Roles, invitations, provider secret configuration, retention and disclosure settings |

Use actual concepts in the UI: a quota percentage, a credit-spending cap, a subscription charge and a forecast are different values. Never label token usage as invoice spending or a recommendation as realized savings.

## Required, optional and deferred

Required: tenant isolation; local authentication without mandatory SaaS; pairing/revocation; monitoring independent of sessions; fresh/stale/unknown semantics; policy recommendations; durable authorization and budget reservations for supported effects; observable recovery; migration and backup tooling; documented provider support.

Required before enabling Claude Enterprise writes: read and write scopes, a designated test organization/member, verified amount/period semantics, and a live apply/read/restore test under an explicit financial authorization. Without those inputs the monitor remains useful and the connector remains disabled. Offline fixture tests cannot satisfy this gate.

Optional: SMTP for delivering invitation/reset links, optional identity-provider login, CSV export. Invite links can be copied by administrators without SMTP; passwords and reset links must not be logged. SMTP is required for unattended email recovery, not for local bootstrap.

Deferred: subscription purchases or cancellations, automatic account issuance, credential sharing/login rotation, cross-provider account routing, annual seat optimization, SSO/SCIM rollout, our own hosted-product payments, arbitrary plugin systems, large analytics pipelines, multi-replica deployment and notifications beyond in-app review.

## First useful slice

Clean local setup → bootstrap → organization and member → HCP pairing → successful account snapshot → tenant-scoped PostgreSQL persistence → account card → 95% policy explanation → app restart → same identity/policy/history with newly evaluated freshness.

This slice sends no prompts and performs no billing writes. A recorded unavailable response also has a valid terminal result: the UI explains unavailability and does not invent a percentage.

## Evidence and assumptions

Verified upstream at HCP commit `68a1afcd0cbe44da73d89474245fd7c931bb3d27`: account read/snapshot protocol, account reducer, Codex and experimental Claude collectors, optional management implementation and local demo exist. Earlier live validation returned Codex windows; the signed-in Claude Team account returned `not_applicable`. This is evidence for those accounts at that time, not a guarantee for every provider plan.

Decisions: PostgreSQL only; one active app process per database initially; no required hosted authentication/database; application owns optimization policy; HCP management extraction precedes app dependency freeze.

Assumptions: the first usable deployment is a small organization on one server; users can install an HCP runner and obtain their provider login independently. The framework/WebSocket production-build integration must be proved before detailed UI implementation. Open risks and gating evidence are listed in [delivery and validation](05-delivery-and-validation.md).
