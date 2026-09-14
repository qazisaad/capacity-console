# Project instructions

Read README.md and the ordered docs/implementation documents before implementation. This independent app has a working monitoring implementation. Read docs/WORK-REPORT.md for verified behavior and open review findings; the implementation documents remain the intended contract, not a claim that every gate has passed.

- HCP owns harness integration and account observations. This app owns organizations, cost policy and billing administration. Follow docs/implementation/04-hcp-extraction.md for relocation; do not change HCP merely to accommodate this product.
- No runtime or source dependencies on P2A, Agentic Playground or T3. Use pinned public HCP protocol/SDK packages; employee machines separately run HCP runner.
- Normalize at boundaries; use strict typed contracts and discriminated states; enforce invariants in their owning service/database transaction. Keep one canonical business rule, prefer simple implementations and avoid unused abstractions.
- Organization ownership and spending authorization are enforced server-side. UI state and client-supplied grants never authorize an effect.
- Never retry an uncertain provider write. Persist financial identity and reservation before execution; reconcile uncertain outcomes. Preserve production reducer semantics in all tests.
- Implement only evidence-backed provider capabilities. Do not invent subscription purchase or account-issuance APIs. Keep live administration disabled until the documented gate passes.
- Do not copy credentials, local observation data or node_modules. Retain upstream licensing/provenance when moving source.
- Finish each implementation gate through its real terminal outcome and record what was actually tested. Keep unresolved provider/runtime gaps explicit.
- Keep docs consistent with implementation. Do not add nominal Docker or setup commands that cannot run from a clean checkout.
