# Contributing

This repository currently contains implementation documentation, not a working app. Begin with the [README](README.md) and ordered [delivery gates](docs/implementation/05-delivery-and-validation.md).

Run `node scripts/check-docs.mjs` to check local documentation references. When application code is added, commit exact dependencies/lockfile, document real setup commands, and add focused unit, PostgreSQL integration and production-build acceptance checks. Never claim live provider behavior from fixtures.

Keep the repository independent of P2A, Agentic Playground and T3. HCP public protocol/SDK packages are intentional dependencies; sibling directory imports, submodules, copied node_modules, shared application databases and unpublished local package links are not acceptable release dependencies.

HCP policy extraction must follow the [file inventory and release sequence](docs/implementation/04-hcp-extraction.md). Record source commit and license notices when copying code. Do not introduce organization billing rules into HCP to simplify this app.

When implementation evidence changes a durable boundary, update its owning document before building a different architecture. Keep decisions in one place and link to them instead of repeating them in issue descriptions. Gate-one framework integration can proceed; enabling live billing requires its own verified connector and authorization inputs.
