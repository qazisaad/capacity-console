import { sql } from "drizzle-orm";
import { bigserial, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { member, organization, user } from "./auth-schema";

export * from "./auth-schema";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Single row. Bootstrap is consumed once; no public route can reset it. */
export const installation = pgTable("installation", {
  id: integer("id").primaryKey().default(1),
  bootstrapTokenHash: text("bootstrap_token_hash").notNull(),
  bootstrapConsumedAt: tz("bootstrap_consumed_at"),
  bootstrapUserId: text("bootstrap_user_id").references(() => user.id),
  createdAt: tz("created_at").notNull().defaultNow(),
}, table => [sql`CHECK (${table.id} = 1)`]);

/** Unapproved rows carry no tenant reference and cannot read tenant data. */
export const pairingRequests = pgTable("pairing_requests", {
  id: text("id").primaryKey(),
  runnerId: text("runner_id").notNull(),
  hostId: text("host_id").notNull(),
  exchangeSecretHash: text("exchange_secret_hash").notNull(),
  pairingCode: text("pairing_code").notNull(),
  status: text("status", { enum: ["pending", "approved", "denied"] }).notNull().default("pending"),
  expiresAt: tz("expires_at").notNull(),
  organizationId: text("organization_id").references(() => organization.id),
  memberId: text("member_id").references(() => member.id),
  approvedByUserId: text("approved_by_user_id").references(() => user.id),
  runnerRowId: text("runner_row_id"),
  /** Encrypted approved exchange response, redeliverable to the same exchange proof until expiry. */
  credentialEnvelope: text("credential_envelope"),
  createdAt: tz("created_at").notNull().defaultNow(),
  approvedAt: tz("approved_at"),
}, table => [index("pairing_requests_expires_idx").on(table.expiresAt)]);

export const runners = pgTable("runners", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id),
  memberId: text("member_id").notNull().references(() => member.id),
  runnerId: text("runner_id").notNull(),
  hostId: text("host_id").notNull(),
  credentialId: text("credential_id").notNull(),
  credentialSecretHash: text("credential_secret_hash").notNull(),
  connectionGeneration: integer("connection_generation").notNull().default(0),
  lastSeenAt: tz("last_seen_at"),
  revokedAt: tz("revoked_at"),
  createdAt: tz("created_at").notNull().defaultNow(),
}, table => [
  uniqueIndex("runners_credential_uidx").on(table.credentialId),
  uniqueIndex("runners_org_identity_uidx").on(table.organizationId, table.runnerId, table.hostId),
  index("runners_member_idx").on(table.organizationId, table.memberId),
]);

/** One row per (org, runner, provider instance); `state` is the canonical HCP AccountSourceState. */
export const accountSources = pgTable("account_sources", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id),
  runnerRowId: text("runner_row_id").notNull().references(() => runners.id),
  providerInstanceId: text("provider_instance_id").notNull(),
  state: jsonb("state").notNull(),
  accountKey: text("account_key"),
  receivedAt: tz("received_at").notNull(),
  retiredAt: tz("retired_at"),
}, table => [
  uniqueIndex("account_sources_identity_uidx").on(table.organizationId, table.runnerRowId, table.providerInstanceId),
  index("account_sources_account_idx").on(table.organizationId, table.accountKey),
]);

/** Append-only observation samples. History is not a writable current state. */
export const observationHistory = pgTable("observation_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id),
  sourceId: text("source_id").notNull().references(() => accountSources.id),
  observedAt: tz("observed_at").notNull(),
  receivedAt: tz("received_at").notNull(),
  observation: jsonb("observation").notNull(),
}, table => [uniqueIndex("observation_history_sample_uidx").on(table.sourceId, table.observedAt)]);

export const providerAccounts = pgTable("provider_accounts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id),
  provider: text("provider").notNull(),
  accountKey: text("account_key").notNull(),
  label: text("label").notNull(),
  scopeSource: text("scope_source", { enum: ["provider", "operator", "local"] }).notNull(),
  memberId: text("member_id").references(() => member.id),
  verification: text("verification", { enum: ["unverified", "verified", "conflict"] }).notNull().default("unverified"),
  revision: integer("revision").notNull().default(1),
  firstSeenAt: tz("first_seen_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
}, table => [uniqueIndex("provider_accounts_key_uidx").on(table.organizationId, table.provider, table.accountKey)]);

/** Immutable revisions; exactly one active per organization. */
export const capacityPolicies = pgTable("capacity_policies", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id),
  revision: integer("revision").notNull(),
  policy: jsonb("policy").notNull(),
  active: boolean("active").notNull().default(true),
  createdByUserId: text("created_by_user_id").references(() => user.id),
  createdAt: tz("created_at").notNull().defaultNow(),
}, table => [
  uniqueIndex("capacity_policies_revision_uidx").on(table.organizationId, table.revision),
  uniqueIndex("capacity_policies_active_uidx").on(table.organizationId).where(sql`${table.active}`),
]);

export const auditEvents = pgTable("audit_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  organizationId: text("organization_id").references(() => organization.id),
  actorUserId: text("actor_user_id"),
  kind: text("kind").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  details: jsonb("details").notNull().default({}),
  createdAt: tz("created_at").notNull().defaultNow(),
}, table => [index("audit_events_org_idx").on(table.organizationId, table.createdAt)]);

/** Database-owned singleton lease for the one supported app process. */
export const runtimeLease = pgTable("runtime_lease", {
  id: integer("id").primaryKey().default(1),
  owner: text("owner").notNull(),
  acquiredAt: tz("acquired_at").notNull(),
  expiresAt: tz("expires_at").notNull(),
}, table => [sql`CHECK (${table.id} = 1)`]);
