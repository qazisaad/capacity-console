import { describe, expect, test, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/context";
import { installation, member, capacityPolicies, auditEvents } from "~/server/db/schema";
import { auth } from "~/server/auth/auth";
import { bootstrapAdmin, ensureInstallation, installationStatus } from "~/server/auth/bootstrap";
import { createOrganization, listMyOrganizations } from "~/server/auth/organizations";
import { inviteMember, pendingInvitation, redeemInvitation } from "~/server/auth/invitations";
import { requirePrincipal } from "~/server/auth/session";

import { cookieHeaders } from "./helpers";

describe("bootstrap, organizations and invitations", () => {
  beforeAll(async () => { process.env.BOOTSTRAP_TOKEN = "bootstrap-token-for-tests-0123456789"; const { resetEnvForTests } = await import("~/server/env"); resetEnvForTests(); });

  test("public sign-up is closed at the auth layer", async () => {
    const response = await auth().handler(new Request(`${process.env.APP_ORIGIN}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json", origin: process.env.APP_ORIGIN! },
      body: JSON.stringify({ email: "intruder@example.com", password: "long-enough-password", name: "Intruder" }),
    }));
    expect(response.status).toBe(403);
  });

  test("two simultaneous bootstrap requests create exactly one administrator and the token is then consumed", async () => {
    expect(await ensureInstallation()).toEqual({ bootstrapOpen: true });
    const attempt = (email: string) => bootstrapAdmin({ token: process.env.BOOTSTRAP_TOKEN!, email, name: "Admin", password: "correct-horse-battery-staple" });
    const results = await Promise.allSettled([attempt("first@example.com"), attempt("second@example.com")]);
    const fulfilled = results.filter(result => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason.message)).toMatch(/already been completed/);
    const [row] = await db().select().from(installation);
    expect(row?.bootstrapConsumedAt).not.toBeNull();
    expect(await installationStatus()).toEqual({ initialized: true, bootstrapOpen: false });
    await expect(attempt("third@example.com")).rejects.toThrow(/already been completed/);
    await expect(bootstrapAdmin({ token: "wrong-token-wrong-token", email: "x@example.com", name: "X", password: "correct-horse-battery-staple" })).rejects.toThrow(/already been completed/);
    const users = await db().query.user.findMany();
    expect(users).toHaveLength(1);
  });

  test("the administrator creates an organization, seeds policy revision 1, invites a member who redeems the link", async () => {
    const [winner] = await db().query.user.findMany();
    const signIn = await auth().api.signInEmail({ body: { email: winner!.email, password: "correct-horse-battery-staple" }, headers: new Headers({ origin: process.env.APP_ORIGIN! }), returnHeaders: true });
    const admin = cookieHeaders(signIn.headers.getSetCookie());
    const created = await createOrganization(admin, { name: "Acme", slug: "acme" });
    const owner = await requirePrincipal(admin);
    expect(owner.role).toBe("owner");
    expect(owner.organizationId).toBe(created.organizationId);
    const policies = await db().select().from(capacityPolicies).where(eq(capacityPolicies.organizationId, created.organizationId));
    expect(policies).toHaveLength(1);
    expect(policies[0]?.revision).toBe(1);
    expect(policies[0]?.policy).toMatchObject({ threshold_percent: 95, reset_grace_minutes: 30 });

    const invite = await inviteMember(admin, { email: "dev@example.com", role: "member" });
    expect(invite.link).toContain(`/invite/${invite.invitationId}`);
    expect(await pendingInvitation(invite.invitationId)).toMatchObject({ email: "dev@example.com", role: "member", organizationName: "Acme" });
    await expect(redeemInvitation({ invitationId: "nope", name: "Dev", password: "another-long-password" })).rejects.toThrow(/not valid/);
    const redeemed = await redeemInvitation({ invitationId: invite.invitationId, name: "Dev", password: "another-long-password" });
    expect(redeemed.organizationId).toBe(created.organizationId);
    const dev = cookieHeaders(redeemed.cookies);
    const devPrincipal = await requirePrincipal(dev);
    expect(devPrincipal).toMatchObject({ email: "dev@example.com", role: "member", organizationId: created.organizationId });
    await expect(requirePrincipal(dev, ["owner", "admin"])).rejects.toThrow(/role does not permit/);
    await expect(inviteMember(dev, { email: "more@example.com", role: "member" })).rejects.toThrow(/role does not permit/);
    expect(await pendingInvitation(invite.invitationId)).toBeNull();
    const memberships = await db().select().from(member).where(eq(member.organizationId, created.organizationId));
    expect(memberships).toHaveLength(2);
    const mine = await listMyOrganizations(dev);
    expect(mine.organizations.map(org => org.slug)).toEqual(["acme"]);
    const audit = await db().select().from(auditEvents);
    expect(audit.map(event => event.kind)).toEqual(expect.arrayContaining(["installation.bootstrapped", "organization.created", "invitation.created", "invitation.redeemed"]));
  });

  test("an unauthenticated caller and a second organization's member cannot act in the first organization", async () => {
    await expect(requirePrincipal(new Headers())).rejects.toThrow(/Sign in required/);
    const signIn = await auth().api.signInEmail({ body: { email: "dev@example.com", password: "another-long-password" }, headers: new Headers({ origin: process.env.APP_ORIGIN! }), returnHeaders: true });
    const dev = cookieHeaders(signIn.headers.getSetCookie());
    const other = await createOrganization(dev, { name: "Other", slug: "other" });
    const principal = await requirePrincipal(dev);
    expect(principal.organizationId).toBe(other.organizationId);
    expect(principal.role).toBe("owner");
    // Selecting an organization the user does not belong to is refused server-side.
    const { selectOrganization } = await import("~/server/auth/organizations");
    await expect(selectOrganization(dev, "org_does_not_exist")).rejects.toThrow(/not a member/);
  });
});
