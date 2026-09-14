import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { bootstrapAdmin, bootstrapInputSchema, installationStatus } from "../auth/bootstrap";
import { createOrganization, createOrganizationInputSchema, listMyOrganizations, selectOrganization } from "../auth/organizations";
import { acceptInvitationAsCurrentUser, inviteMember, inviteInputSchema, pendingInvitation, redeemInputSchema, redeemInvitation } from "../auth/invitations";
import { auth } from "../auth/auth";
import { requirePrincipal } from "../auth/session";
import { applyCookies, attempt, requestHeaders } from "./_shared";

export const getInstallationStatus = createServerFn({ method: "GET" }).handler(() => installationStatus());

export const bootstrap = createServerFn({ method: "POST" }).inputValidator(bootstrapInputSchema)
  .handler(({ data }) => attempt(async () => { const result = await bootstrapAdmin(data); applyCookies(result.cookies); return { userId: result.userId }; }));

export const signIn = createServerFn({ method: "POST" }).inputValidator(z.object({ email: z.email(), password: z.string().min(1).max(256) }))
  .handler(({ data }) => attempt(async () => {
    const result = await auth().api.signInEmail({ body: data, headers: requestHeaders(), returnHeaders: true });
    applyCookies(result.headers.getSetCookie());
    return { userId: result.response.user.id };
  }));

export const signOut = createServerFn({ method: "POST" }).handler(() => attempt(async () => {
  const result = await auth().api.signOut({ headers: requestHeaders(), returnHeaders: true });
  applyCookies(result.headers.getSetCookie());
  return {};
}));

/** Who am I, in which organization, with which role. Null when signed out. */
export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  const headers = requestHeaders();
  const session = await auth().api.getSession({ headers });
  if (!session) return null;
  const organizations = await listMyOrganizations(headers);
  const principal = organizations.activeOrganizationId ? await requirePrincipal(headers).catch(() => null) : null;
  return { user: { id: session.user.id, email: session.user.email, name: session.user.name }, ...organizations, role: principal?.role ?? null, memberId: principal?.memberId ?? null };
});

export const createOrg = createServerFn({ method: "POST" }).inputValidator(createOrganizationInputSchema)
  .handler(({ data }) => attempt(() => createOrganization(requestHeaders(), data)));

export const selectOrg = createServerFn({ method: "POST" }).inputValidator(z.object({ organizationId: z.string().min(1) }))
  .handler(({ data }) => attempt(async () => { await selectOrganization(requestHeaders(), data.organizationId); return {}; }));

export const invite = createServerFn({ method: "POST" }).inputValidator(inviteInputSchema)
  .handler(({ data }) => attempt(() => inviteMember(requestHeaders(), data)));

export const getInvitation = createServerFn({ method: "GET" }).inputValidator(z.object({ invitationId: z.string().min(1) }))
  .handler(({ data }) => pendingInvitation(data.invitationId));

export const redeem = createServerFn({ method: "POST" }).inputValidator(redeemInputSchema)
  .handler(({ data }) => attempt(async () => { const result = await redeemInvitation(data); applyCookies(result.cookies); return { organizationId: result.organizationId }; }));

export const acceptInvite = createServerFn({ method: "POST" }).inputValidator(z.object({ invitationId: z.string().min(1) }))
  .handler(({ data }) => attempt(() => acceptInvitationAsCurrentUser(requestHeaders(), data.invitationId)));
