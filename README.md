# Capacity Console

An independent, open-source organization app for understanding coding-agent account capacity and managing authorized usage spending.

**Status: implementation documentation only.** There is no running application, Docker image, database migration, or relocated HCP code yet. Capacity Console is a working name. The implementation documents below are the build contract; they distinguish implemented upstream behavior from planned application behavior and verification gates.

The intended stack is TanStack Start, React, TypeScript, PostgreSQL, Drizzle, Better Auth, and a Node.js HCP WebSocket endpoint. The deployment target is one application container and PostgreSQL. Basic operation must not require a cloud service account. No runtime or source dependency on P2A, Agentic Playground, or T3 is permitted.

## Read in this order

1. [Product scope](docs/implementation/01-product-scope.md): users, screens, supported behavior and exclusions.
2. [Architecture and data](docs/implementation/02-architecture-contract.md): stack, ownership, authorization, storage and boundaries.
3. [Behavior and recovery](docs/implementation/03-behavior-and-recovery.md): pairing, observations, decisions, spending and failure handling.
4. [HCP extraction](docs/implementation/04-hcp-extraction.md): exact source inventory, move/keep decisions and release sequencing.
5. [Delivery and validation](docs/implementation/05-delivery-and-validation.md): implementation gates and observable acceptance scenarios.

[Self-hosting requirements](docs/self-hosting.md) define the installation, configuration, backup and upgrade experience that the implementation must deliver. [Contributing](CONTRIBUTING.md) explains how to develop from these documents.

## Repository boundary

HCP connects to and observes employee-machine harnesses. Capacity Console owns company membership, account assignments, policies, budgets, billing integrations, approvals, scheduling and audit storage. The app will use pinned public `@harness-control/protocol` and `@harness-control/sdk` packages; employees run `@harness-control/runner`. The app will not depend on `@harness-control/management`: its useful implementation is to be relocated here under the extraction plan.

Automatic subscription purchases, account issuance and login rotation are not currently supported. Account monitoring and recommendations can ship independently of provider administration. A Claude Enterprise spending-cap change permits future charges; it does not upgrade a subscription.

## Current checks

Node.js is sufficient to check this documentation-only repository:

```sh
node scripts/check-docs.mjs
```

Application installation commands will be added only after they have been implemented and tested from a clean clone. No cloud repository or deployment has been created by this initialization.

## License

Apache-2.0; see [LICENSE](LICENSE). Any code subsequently moved from HCP must retain its applicable notices and source provenance as described in the extraction plan.
