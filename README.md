# Capacity Console

An independent, open-source organization app for understanding coding-agent account capacity and managing authorized usage spending.

**Status: monitoring works locally, including browser pairing and a real Codex read. Review found open identity, offboarding and operational gaps; gates 1 and 2 are not fully accepted. Decisions and authorized effects remain incomplete.** Capacity Console is a working name. See [the work report](docs/WORK-REPORT.md) for what is verified, what is deferred and what needs the repository owner.

Stack: TanStack Start, React, TypeScript, PostgreSQL, Drizzle, Better Auth (organization plugin) and a Node.js HCP WebSocket endpoint, all in one Node process plus PostgreSQL. No cloud service account is required. No runtime or source dependency on P2A, Agentic Playground or T3 exists.

## What works today

- One-time bootstrap of the first administrator, closed public sign-up, invitation-only membership with owner, admin, member and auditor roles, and per-request server-side authorization.
- HCP pairing (`/pairing-codes`, `/pairing-exchange`, `/runner-connection-token`), browser approval of a machine for a member, short-lived single-use connection tokens, and the `/runner` WebSocket on the same origin.
- Account observations read through the public HCP SDK, reduced by HCP's canonical reducer, persisted per organization with append-only history, and shown on the overview and account pages with the active policy's explanation. Unknown values stay unknown.
- Immutable capacity policy revisions, account-to-member assignment with verification, runner revocation with socket fencing, a database-owned singleton lease, health endpoints, audit events and graceful shutdown.
- Relocated policy, spend and Claude Enterprise adapter code with provenance; the connector stays disabled.

## Run it locally

Requires Node 22 and PostgreSQL (Docker is the quickest: `scripts/dev-db.sh`).

```sh
npm ci
scripts/dev-db.sh
npm run setup                     # writes .local/app.env with generated secrets
node --env-file=.local/app.env server/migrate.mjs
npm run build
node --env-file=.local/app.env server/index.mjs
```

Open `APP_ORIGIN/bootstrap`, enter the bootstrap token from `.local/app.env`, create the organization, invite members. Each member pairs their machine with the public HCP runner:

```sh
npx @harness-control/runner@0.4.0 connect ws://localhost:3000/runner
```

Until 0.4.0 is published, use `node_modules/.bin/hcp-runner` from this checkout instead of the registry command above.

The runner prints an approval link that opens the app. Enable account usage per provider in the runner configuration (see the HCP runner README).

## Checks

```sh
npm run typecheck
npm run test:unit
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/capacity_test npm run test:integration
node scripts/check-docs.mjs
```

Integration tests need a real PostgreSQL and exercise the actual runner package, WebSocket, reducer and database. `scripts/dev-db.sh` starts a matching Docker database.

## Read in this order

1. [Product scope](docs/implementation/01-product-scope.md)
2. [Architecture and data](docs/implementation/02-architecture-contract.md)
3. [Behavior and recovery](docs/implementation/03-behavior-and-recovery.md)
4. [HCP extraction](docs/implementation/04-hcp-extraction.md)
5. [Delivery and validation](docs/implementation/05-delivery-and-validation.md)

[Self-hosting](docs/self-hosting.md) describes installation, configuration, backup and upgrade. [Provenance](docs/PROVENANCE.md) records code moved from HCP. [Contributing](CONTRIBUTING.md) explains how to develop.

## Repository boundary

HCP connects to and observes employee-machine harnesses. Capacity Console owns company membership, account assignments, policies, budgets, billing integrations, approvals, scheduling and audit storage. The app uses the public `@harness-control/protocol` and `@harness-control/sdk` packages; employees run `@harness-control/runner`. Until 0.4.0 of those packages is published, the exact 0.4.0 release tarballs are vendored under `vendor/` with recorded checksums; switching to registry versions is a one-line change per package.

Automatic subscription purchases, account issuance and login rotation are not supported. A Claude Enterprise spending-cap change permits future charges; it does not upgrade a subscription.

## License

Apache-2.0; see [LICENSE](LICENSE). Code moved from HCP retains its notices as described in [PROVENANCE](docs/PROVENANCE.md).
