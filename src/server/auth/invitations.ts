import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/context";
import { invitation } from "../db/schema";
import { env } from "../env";
import { recordAudit } from "../audit";
import { auth, INTERNAL_SIGNUP_HEADER, internalSignupMarker } from "./auth";
import { isRole, type Role } from "./access";
import { AuthorizationError, requirePrincipal } from "./session";

export const inviteInputSchema = z.object({ email: z.email().max(254), role: z.enum(["admin", "member", "auditor"]) });
export const redeemInputSchema = z.object({
  invitationId: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(256),
});

/** Owners and admins invite. Owner role is granted only through ownership transfer, never by invitation. */
export async function inviteMember(headers: Headers, input: z.infer<typeof inviteInputSchema>): Promise<{ invitationId: string; link: string; expiresAt: string }> {
  const data = inviteInputSchema.parse(input);
  const principal = await requirePrincipal(headers, ["owner", "admin"]);
  const created = await auth().api.createInvitation({ body: { email: data.email, role: data.role, organizationId: principal.organizationId, resend: true }, headers });
  await recordAudit(db(), { organizationId: principal.organizationId, actorUserId: principal.userId, kind: "invitation.created", subjectType: "invitation", subjectId: created.id, details: { role: data.role } });
  return { invitationId: created.id, link: invitationLink(created.id), expiresAt: new Date(created.expiresAt).toISOString() };
}

export function invitationLink(id: string): string { return new URL(`/invite/${encodeURIComponent(id)}`, env().APP_ORIGIN).toString(); }

/** Public, read-only view of a pending invitation for the redemption page. Reveals only what the invitee already knows. */
export async function pendingInvitation(invitationId: string) {
  const row = await db().query.invitation.findFirst({
    where: and(eq(invitation.id, invitationId), eq(invitation.status, "pending"), gt(invitation.expiresAt, new Date())),
    with: { organization: true },
  });
  if (!row) return null;
  const role: Role = row.role && isRole(row.role) ? row.role : "member";
  return { id: row.id, email: row.email, role, organizationName: row.organization.name, expiresAt: row.expiresAt.toISOString() };
}

/** New user: create the account for exactly the invited email, accept the invitation, and select the organization. */
export async function redeemInvitation(input: z.infer<typeof redeemInputSchema>): Promise<{ organizationId: string; cookies: string[] }> {
  const data = redeemInputSchema.parse(input);
  const pending = await pendingInvitation(data.invitationId);
  if (!pending) throw new AuthorizationError(403, "This invitation is not valid. Ask an administrator for a new link.");
  const signUp = await auth().api.signUpEmail({
    body: { email: pending.email, password: data.password, name: data.name },
    headers: new Headers({ [INTERNAL_SIGNUP_HEADER]: internalSignupMarker }),
    returnHeaders: true,
  });
  const cookies = signUp.headers.getSetCookie();
  const sessionHeaders = new Headers({ cookie: cookies.map(cookie => cookie.split(";")[0]!).join("; ") });
  const accepted = await auth().api.acceptInvitation({ body: { invitationId: data.invitationId }, headers: sessionHeaders });
  if (!accepted) throw new AuthorizationError(409, "The invitation could not be accepted.");
  await auth().api.setActiveOrganization({ body: { organizationId: accepted.invitation.organizationId }, headers: sessionHeaders });
  await recordAudit(db(), { organizationId: accepted.invitation.organizationId, actorUserId: signUp.response.user.id, kind: "invitation.redeemed", subjectType: "invitation", subjectId: data.invitationId });
  return { organizationId: accepted.invitation.organizationId, cookies };
}

/** Existing signed-in user accepting an invitation addressed to their email. */
export async function acceptInvitationAsCurrentUser(headers: Headers, invitationId: string): Promise<{ organizationId: string }> {
  const accepted = await auth().api.acceptInvitation({ body: { invitationId }, headers });
  if (!accepted) throw new AuthorizationError(409, "The invitation could not be accepted.");
  await auth().api.setActiveOrganization({ body: { organizationId: accepted.invitation.organizationId }, headers });
  return { organizationId: accepted.invitation.organizationId };
}
