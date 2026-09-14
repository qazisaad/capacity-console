# Contributing

Begin with the [README](README.md), the ordered [delivery gates](docs/implementation/05-delivery-and-validation.md) and the [work report](docs/WORK-REPORT.md).

Run `npm run typecheck`, `npm run test:unit`, `npm run test:integration` (real PostgreSQL, see `scripts/dev-db.sh`) and `node scripts/check-docs.mjs`. Dependencies are pinned exactly with a committed lockfile. Add focused unit tests for pure logic, PostgreSQL integration tests for anything touching authority, locking or the reducer, and production-build checks for runtime composition. Never claim live provider behavior from fixtures; label injected provider data as such.

Keep the repository independent of P2A, Agentic Playground and T3. HCP public protocol/SDK packages are intentional dependencies; sibling directory imports, submodules, copied node_modules, shared application databases and unpublished local package links are not acceptable release dependencies.

HCP policy extraction must follow the [file inventory and release sequence](docs/implementation/04-hcp-extraction.md). Record source commit and license notices when copying code. Do not introduce organization billing rules into HCP to simplify this app.

When implementation evidence changes a durable boundary, update its owning document before building a different architecture. Keep decisions in one place and link to them instead of repeating them in issue descriptions. Gate-one framework integration can proceed; enabling live billing requires its own verified connector and authorization inputs.
