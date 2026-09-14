# Self-hosting

**Reviewed status (2026-09-14):** production build, fresh-source Compose with a new volume, restart persistence and a separate database restore passed on the development host. Installation and restore commands appear below. Identity, offboarding and public-deployment gaps remain in [the work report](WORK-REPORT.md); a separate clean-machine acceptance and cross-version upgrade are not verified.
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

Variables are validated at startup by `src/server/env.ts`; [.env.example](../.env.example) mirrors them. Keep the schema and this table synchronized. Secrets are server-only and never exposed through client-prefixed environment variables.

| Variable | Purpose and behavior |
| --- | --- |
| `APP_ORIGIN` | Canonical HTTP(S) browser/API origin; derive HCP WS(S) URL and cookie/origin checks from it |
| `PORT` | App listener port, default 3000; internal container binding must match published mapping |
| `DATABASE_URL` | PostgreSQL credentials/connection; setup defaults to the loopback development DB; operators may provide an existing DB |
| `POSTGRES_PASSWORD` | Compose-only database password; generated separately and shared by app/database containers |
| `BETTER_AUTH_SECRET` | Persistent authentication secret, generated during setup |
| `CREDENTIAL_ENCRYPTION_KEY`, `CREDENTIAL_ENCRYPTION_KEY_ID` | Persistent base64 32-byte AES-256-GCM key and its id for org connector secrets and pairing delivery envelopes; losing it makes encrypted values unreadable. `*_PREVIOUS`/`*_PREVIOUS_ID` keep an old key readable during rotation |
| `BOOTSTRAP_TOKEN` | One-time installation secret used only until bootstrap consumption; remove from deployed config afterward |
| `SMTP_URL`, `SMTP_FROM` | Reserved; delivery and operator recovery are not implemented. Current invitations use admin-copy links |

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

## Reviewed installation commands (2026-09-14)

The monitoring build remains a development preview. Resolve the release blockers in [the work report](WORK-REPORT.md) before exposing it to employees over the public Internet. SMTP settings are reserved configuration; delivery and independent email verification are not implemented.

For local development, use the README commands. Setup defaults to the loopback-only development database from `scripts/dev-db.sh`; its known database password is for disposable development only. For an existing PostgreSQL instance, pass its `DATABASE_URL` to setup before the first run. Re-running setup preserves existing configuration, so change an existing file explicitly when moving databases.

For Compose, setup generates a separate strong `POSTGRES_PASSWORD`. Both the database container and app use this same value; the database port is not published. From a fresh checkout:

```sh
npm run setup
docker compose --env-file .local/app.env up -d --build
docker compose --env-file .local/app.env ps
curl --fail http://localhost:3000/health/ready
```

Use `APP_ORIGIN=http://localhost:YOUR_PORT npm run setup` on the first run to choose a different local port. The generated file contains the corresponding `PORT`. Node 22 is needed for the setup script; the application build and PostgreSQL run inside Docker. No registry-published HCP 0.4.0 is required for this preview because the checked-in tarballs supply it.

### Backup and restore the monitoring database

A reviewed sample restored one organization, two memberships, one runner and four real observation-history rows into a separate empty PostgreSQL 17 database. The restored production server passed readiness after the copied lease expired. This verifies the monitoring schema, not recovery of future financial actions.

Stop the app for a quiescent deployment backup; retain the database and `.local/app.env` in separately protected storage. The env file contains secrets. The commands below run from the Compose checkout:

```sh
umask 077
mkdir -p backups
docker compose --env-file .local/app.env stop app
docker compose --env-file .local/app.env exec -T db pg_dump -U capacity -d capacity -Fc > backups/capacity.dump
cp .local/app.env backups/app.env
docker compose --env-file .local/app.env start app
```

Restore only to a **new empty database/volume**, using a new Compose project name and a checkout of the same application revision. Restore the saved environment into `.local/app.env` first and preserve its auth/encryption keys. Choose an unused local port in that file if the original installation still runs.

```sh
docker compose -p capacity-restore --env-file .local/app.env up -d --wait db
docker compose -p capacity-restore --env-file .local/app.env exec -T db pg_restore -U capacity -d capacity --no-owner --no-acl < backups/capacity.dump
docker compose -p capacity-restore --env-file .local/app.env up -d --build
```

Readiness can initially report lease contention for up to the saved lease's remaining 30-second lifetime plus the 10-second acquisition interval. Do not delete a live installation's lease to force two active app processes. Check readiness, sign in with a restored account, confirm memberships/history, and perform a read-only runner refresh after routing the runner to the restored origin. A changed origin requires a separate pairing; do not rewrite existing credentials to pretend they belong to another server.

### Upgrade the preview

Record the current commit/image and back up first. Stop the single app, update to the reviewed commit, rebuild, run the migration service, then start the app. Confirm readiness, sign-in, preserved history and a real runner read. Do not use `docker compose down -v` during upgrades. A schema rollback requires a compatible database backup and matching application image; restarting an old binary against newer migrations is not a rollback. There is no verified cross-version upgrade path yet because this is the first implemented schema.
