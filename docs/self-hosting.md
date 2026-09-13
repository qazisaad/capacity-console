# Self-hosting contract

**This is the required deployment experience to implement, not an installation guide for an existing app.** Compose files, setup scripts, migrations and images do not exist yet. Replace planned steps with tested commands as delivery gate five completes. The current runnable check is `node scripts/check-docs.mjs`.

## Supported deployment

One app container and one PostgreSQL database, locally or on a Linux server. The app serves browser HTTP and authenticated HCP WebSockets on the same public origin; employee machines initiate outbound connections. One active app process per database is supported initially, enforced by a database lease. Managed PostgreSQL is optional and uses the same schema/behavior. Production TLS may be terminated by the operator's existing reverse proxy; provide one tested example with WebSocket forwarding and trusted proxy configuration.

Do not require registration with a hosted auth, database, telemetry, email or orchestration service. Never bundle provider logins into the app image. Basic local usage requires only Docker/Compose, persistent storage and separately installed HCP runners. Development also requires the pinned Node runtime and npm lockfile.

## Installation behavior to build

1. A setup command creates private local configuration, generates independent strong secrets, refuses to overwrite existing keys, and explains which origin employees will use. It must never install a fixed default password.
2. Compose starts PostgreSQL and the app with persistent volumes and health checks. Database ports are not published externally by default. The app binds loopback for a local install; public exposure requires explicit origin/TLS configuration.
3. A one-shot migration command runs versioned Drizzle migrations under an exclusive database lock. The normal app refuses readiness for an incompatible schema; it does not race another process to mutate it silently.
4. The operator redeems a generated one-time bootstrap token to create the first admin. The bootstrap route closes permanently after success. Secrets cannot appear in public logs; deliver bootstrap material through the local setup output/file only.
5. The admin creates an organization, invites a member, and approves that member's HCP pairing. Explain account-usage disclosure and local opt-in. The app sends no agent prompts.
6. Repeating setup/restart preserves keys, organizations, runner bindings and financial evidence. It does not seed sample users or fictitious provider readings.

## Configuration contract

Proposed variable names are recorded in [.env.example](../.env.example); they are not consumed by code yet. Keep the eventual schema and this table synchronized. Secrets are server-only and never exposed through client-prefixed environment variables.

| Variable | Purpose and behavior |
| --- | --- |
| `APP_ORIGIN` | Canonical HTTP(S) browser/API origin; derive HCP WS(S) URL and cookie/origin checks from it |
| `PORT` | App listener port, default 3000; internal container binding must match published mapping |
| `DATABASE_URL` | PostgreSQL credentials/connection; setup generates local password and writes private config |
| `BETTER_AUTH_SECRET` | Persistent authentication secret, generated during setup |
| `CREDENTIAL_ENCRYPTION_KEY` | Persistent encryption key for org connector secrets and pairing delivery envelopes; losing it makes encrypted values unreadable |
| `BOOTSTRAP_TOKEN` | One-time installation secret used only until bootstrap consumption; remove from deployed config afterward |
| `SMTP_URL`, `SMTP_FROM` | Optional email delivery; without them use admin-copy invitation links and an explicit local operator account-recovery procedure |

Use versioned key ids in encrypted values to support controlled rotation. Keep an old decryption key available during re-encryption, and verify all rows before retiring it. Store org-specific provider admin keys through authorized server endpoints into encrypted connection records; do not require a single global Anthropic key for all tenants. Connector capability and verified organization identity accompany the secret. Runner subscription credentials remain on employee machines.

## Backup, restore and upgrades

Back up PostgreSQL consistently plus deployment encryption/auth keys in separate protected storage. A database-only backup cannot recover encrypted connector secrets. Document a tested `pg_dump`/restore procedure and an actual sample restore check at release time. Backup retention is operator-configurable; app data retention cannot delete unresolved actions or their evidence.

On restore, pause provider writes before starting recovery. Restoring an older ledger can resurrect work already executed at the provider: old `authorized` actions are not automatically safe. Reconcile potentially affected actions against preserved post-backup evidence/provider state and require owner reauthorization before any new effect. Monitoring can resume while billing stays paused.

Upgrade: back up, pause dispatch, drain the one supported app instance, run migrations once, deploy the pinned image, check readiness and perform a read-only runner smoke test. Publish migration compatibility and rollback notes. Do not assume old app binaries understand a newer schema. Financial state is not rolled back by replaying a previously authorized write.

## Operational acceptance

- `/health/live` proves the process is alive; `/health/ready` checks database access, schema version, encryption configuration and singleton ownership. Neither endpoint exposes secrets or tenant data.
- Graceful shutdown stops new effects/reads, closes WebSockets, and preserves unknown outcomes for reconciliation.
- Logs identify organization/resource/action by safe ids and redact credentials, auth tokens, request bodies and provider error bodies. Monitoring availability is independent of billing connector health.
- No externally sent product telemetry by default. If introduced later, document exactly what leaves the installation and make it optional.
- Onboarding, role changes and integration setup remain available on the same code path for local and hosted deployments. Do not implement a hidden hosted-only authority bypass.
- Recovery tooling can revoke sessions or generate a one-use password recovery token through authenticated local operator access; it cannot reveal an existing password or bypass tenant billing grants.

Do not advertise one-command installation until a clean-clone test proves setup → login → pairing → real persisted observation → restart. The future hosted service should deploy this same image and database model, with operator-provided hosting configuration.
