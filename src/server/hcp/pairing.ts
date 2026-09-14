import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import {
  HCP_VERSION, connectionTokenRequestSchema, pairingCreateRequestSchema, pairingExchangeRequestSchema,
  type PairingCodeResponse,
} from "@harness-control/protocol";
import { z } from "zod";
import { db } from "../db/context";
import { member, pairingRequests, runners } from "../db/schema";
import { env } from "../env";
import { recordAudit } from "../audit";
import { decryptSecret, digest, digestMatches, encryptSecret, randomId, randomToken } from "../secrets";
import { AuthorizationError, type Principal } from "../auth/session";
import { PairingError } from "./errors";
import { INSTALLED_PROTOCOL_SCHEMA_SHA256 } from "./protocol-version";

export const PAIRING_TTL_MS = 10 * 60_000;
export const POLL_INTERVAL_SECONDS = 3;
export const CONNECTION_TOKEN_TTL_MS = 60_000;

const approvedResponseSchema = z.object({
  status: z.literal("approved"), control_plane_url: z.url(),
  credential: z.object({ credential_id: z.string(), credential_secret: z.string(), runner_id: z.string(), host_id: z.string(), control_plane_url: z.url(), issued_at: z.string(), mcp_proof_secret: z.string() }),
});
type ApprovedResponse = z.infer<typeof approvedResponseSchema>;

/** WebSocket endpoint derived from the configured origin; never from a request header. */
export function runnerEndpoint(): string {
  const url = new URL(env().APP_ORIGIN);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/runner";
  return url.toString();
}

/** Step 1 (runner, unauthenticated): register identity and the hash of a secret only the runner holds. */
export async function createPairingRequest(input: unknown): Promise<PairingCodeResponse> {
  const body = pairingCreateRequestSchema.parse(input);
  if (body.protocol_version !== HCP_VERSION) throw new PairingError(400, "Unsupported protocol version.");
  const id = randomId();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  const pairingCode = humanCode();
  await db().insert(pairingRequests).values({ id, runnerId: body.runner_id, hostId: body.host_id, exchangeSecretHash: body.exchange_secret_hash, pairingCode, expiresAt });
  return { request_id: id, pairing_code: pairingCode, pairing_url: new URL(`/pair/${id}`, env().APP_ORIGIN).toString(), expires_at: expiresAt.toISOString(), poll_interval_seconds: POLL_INTERVAL_SECONDS };
}

/** Step 3 (runner polls): only the matching identity plus exchange-secret proof can collect the approved credential. */
export async function exchangePairing(input: unknown): Promise<{ status: "pending" } | ApprovedResponse> {
  const body = pairingExchangeRequestSchema.parse(input);
  const row = await db().query.pairingRequests.findFirst({ where: eq(pairingRequests.id, body.request_id) });
  if (!row || row.runnerId !== body.runner_id || row.hostId !== body.host_id || body.protocol_version !== HCP_VERSION
    || !digestMatches(body.exchange_secret, row.exchangeSecretHash)) throw new PairingError(404, "Pairing request not found.");
  if (row.expiresAt.getTime() <= Date.now()) throw new PairingError(410, "Pairing request expired. Start a new pairing request.");
  if (row.status === "pending") return { status: "pending" };
  if (row.status === "denied") throw new PairingError(403, "Pairing request was denied.");
  if (!row.credentialEnvelope) throw new PairingError(410, "Pairing credential is no longer available. Start a new pairing request.");
  return approvedResponseSchema.parse(JSON.parse(decryptSecret(row.credentialEnvelope, `pairing:${row.id}`)));
}

export async function getPairingRequestForApproval(requestId: string) {
  const row = await db().query.pairingRequests.findFirst({ where: eq(pairingRequests.id, requestId) });
  if (!row) return null;
  return { id: row.id, runnerId: row.runnerId, hostId: row.hostId, status: row.expiresAt.getTime() <= Date.now() && row.status === "pending" ? "expired" as const : row.status, expiresAt: row.expiresAt.toISOString(), organizationId: row.organizationId };
}

/**
 * Step 2 (browser, authenticated): a member approves for themselves in the active organization. An owner/admin may
 * enroll on behalf of a named member; that is a separate audited event. The short code alone approves nothing.
 */
export async function approvePairing(principal: Principal, requestId: string, options: { memberId?: string } = {}): Promise<{ runnerRowId: string }> {
  return db().transaction(async tx => {
    const [row] = await tx.select().from(pairingRequests).where(eq(pairingRequests.id, requestId)).for("update");
    if (!row) throw new AuthorizationError(409, "Pairing request not found.");
    if (row.status !== "pending") throw new AuthorizationError(409, "This pairing request was already resolved.");
    if (row.expiresAt.getTime() <= Date.now()) throw new AuthorizationError(409, "This pairing request has expired. Start pairing again on the machine.");
    let targetMemberId = principal.memberId;
    let onBehalf = false;
    if (options.memberId && options.memberId !== principal.memberId) {
      if (!["owner", "admin"].includes(principal.role)) throw new AuthorizationError(403, "Only owners and admins can enroll a machine for another member.");
      const target = await tx.query.member.findFirst({ where: and(eq(member.id, options.memberId), eq(member.organizationId, principal.organizationId)) });
      if (!target) throw new AuthorizationError(403, "That member is not part of this organization.");
      targetMemberId = target.id; onBehalf = true;
    }
    const credentialId = randomId();
    const credentialSecret = randomToken(32);
    const existing = await tx.query.runners.findFirst({ where: and(eq(runners.organizationId, principal.organizationId), eq(runners.runnerId, row.runnerId), eq(runners.hostId, row.hostId)) });
    let runnerRowId: string;
    if (existing) {
      if (!existing.revokedAt) throw new AuthorizationError(409, "This machine is already paired in this organization. Revoke it first to re-pair.");
      if (existing.memberId !== targetMemberId) throw new AuthorizationError(409, "This machine record belongs to another member. Revoke and offboard it before re-assigning.");
      runnerRowId = existing.id;
      await tx.update(runners).set({ credentialId, credentialSecretHash: digest(credentialSecret), revokedAt: null, connectionGeneration: existing.connectionGeneration + 1 }).where(eq(runners.id, existing.id));
    } else {
      runnerRowId = randomId();
      await tx.insert(runners).values({ id: runnerRowId, organizationId: principal.organizationId, memberId: targetMemberId, runnerId: row.runnerId, hostId: row.hostId, credentialId, credentialSecretHash: digest(credentialSecret) });
    }
    const endpoint = runnerEndpoint();
    const response: ApprovedResponse = { status: "approved", control_plane_url: endpoint, credential: {
      credential_id: credentialId, credential_secret: credentialSecret, runner_id: row.runnerId, host_id: row.hostId,
      control_plane_url: endpoint, issued_at: new Date().toISOString(),
      // Wire compatibility only: this app exposes no harness or MCP operations.
      mcp_proof_secret: randomToken(32),
    } };
    await tx.update(pairingRequests).set({
      status: "approved", organizationId: principal.organizationId, memberId: targetMemberId, approvedByUserId: principal.userId, runnerRowId,
      credentialEnvelope: encryptSecret(JSON.stringify(response), `pairing:${row.id}`), approvedAt: sql`now()`,
    }).where(eq(pairingRequests.id, row.id));
    await recordAudit(tx, { organizationId: principal.organizationId, actorUserId: principal.userId, kind: onBehalf ? "pairing.approved_on_behalf" : "pairing.approved", subjectType: "runner", subjectId: runnerRowId, details: { requestId: row.id, memberId: targetMemberId, hostId: row.hostId } });
    return { runnerRowId };
  });
}

export async function denyPairing(principal: Principal, requestId: string): Promise<void> {
  const updated = await db().update(pairingRequests).set({ status: "denied" }).where(and(eq(pairingRequests.id, requestId), eq(pairingRequests.status, "pending"))).returning({ id: pairingRequests.id });
  if (!updated.length) throw new AuthorizationError(409, "This pairing request was already resolved.");
  await recordAudit(db(), { organizationId: principal.organizationId, actorUserId: principal.userId, kind: "pairing.denied", subjectType: "pairing_request", subjectId: requestId });
}

/** Delivery envelopes are purged at expiry; a lost response after that requires a new pairing. */
export async function purgeExpiredPairingEnvelopes(): Promise<number> {
  const rows = await db().update(pairingRequests).set({ credentialEnvelope: null })
    .where(and(lt(pairingRequests.expiresAt, new Date()), isNotNull(pairingRequests.credentialEnvelope))).returning({ id: pairingRequests.id });
  return rows.length;
}

const tokens = new Map<string, { runnerRowId: string; expiresAt: number }>();

/** Step 4 (runner, before each socket): prove the long-lived credential, receive a short-lived single-use token. */
export async function issueConnectionToken(input: unknown): Promise<{ connection_token: string; expires_at: string }> {
  const body = connectionTokenRequestSchema.parse(input);
  const runner = await db().query.runners.findFirst({ where: eq(runners.credentialId, body.credential_id) });
  if (!runner || runner.revokedAt || runner.runnerId !== body.runner_id || runner.hostId !== body.host_id
    || !digestMatches(body.credential_secret, runner.credentialSecretHash)) throw new PairingError(403, "Runner credential rejected.");
  if (body.protocol_version !== HCP_VERSION) throw new PairingError(400, "Unsupported protocol version.");
  if (body.protocol_schema_sha256 !== INSTALLED_PROTOCOL_SCHEMA_SHA256) throw new PairingError(409, "Runner protocol schema differs from this server. Update the runner to the matching @harness-control/runner release.");
  const active = await db().query.member.findFirst({ where: eq(member.id, runner.memberId) });
  if (!active) throw new PairingError(403, "The member bound to this runner is no longer part of the organization.");
  for (const [token, entry] of tokens) if (entry.expiresAt <= Date.now()) tokens.delete(token);
  const token = randomToken(32);
  const expiresAt = Date.now() + CONNECTION_TOKEN_TTL_MS;
  tokens.set(token, { runnerRowId: runner.id, expiresAt });
  return { connection_token: token, expires_at: new Date(expiresAt).toISOString() };
}

/** Single use. Returns the runner row id or undefined. */
export function consumeConnectionToken(token: string): string | undefined {
  const entry = tokens.get(token);
  tokens.delete(token);
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  return entry.runnerRowId;
}

function humanCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 8; index++) code += alphabet[randomInt(alphabet.length)];
  return code;
}
