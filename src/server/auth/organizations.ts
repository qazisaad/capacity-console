import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/context";
import { capacityPolicies, member } from "../db/schema";
import { recordAudit } from "../audit";
import { randomId } from "../secrets";
import { capacityPolicySchema } from "../capacity/policy";
import { auth, transactionalAuth } from "./auth";
import { AuthorizationError, requireSession } from "./session";

export const createOrganizationInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(2).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, digits and dashes."),
});

/** Create an organization owned by the caller, select it, and seed policy revision 1 with the reference defaults. */
export async function createOrganization(headers: Headers, input: z.infer<typeof createOrganizationInputSchema>): Promise<{ organizationId: string }> {
  const data = createOrganizationInputSchema.parse(input);
  const session = await requireSession(headers);
  return db().transaction(async tx => {
    const scopedAuth = transactionalAuth(tx);
    const created = await scopedAuth.api.createOrganization({ body: { name: data.name, slug: data.slug }, headers });
    if (!created) throw new AuthorizationError(409, "Organization could not be created.");
    await scopedAuth.api.setActiveOrganization({ body: { organizationId: created.id }, headers });
    await tx.insert(capacityPolicies).values({ id: randomId(), organizationId: created.id, revision: 1, policy: capacityPolicySchema.parse({}), active: true, createdByUserId: session.user.id });
    await recordAudit(tx, { organizationId: created.id, actorUserId: session.user.id, kind: "organization.created", subjectType: "organization", subjectId: created.id, details: { slug: data.slug } });
    return { organizationId: created.id };
  });
}

export async function selectOrganization(headers: Headers, organizationId: string): Promise<void> {
  const session = await requireSession(headers);
  const row = await db().query.member.findFirst({ where: and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)) });
  if (!row) throw new AuthorizationError(403, "You are not a member of that organization.");
  await auth().api.setActiveOrganization({ body: { organizationId }, headers });
}

export async function listMyOrganizations(headers: Headers) {
  const session = await requireSession(headers);
  const rows = await db().query.member.findMany({ where: eq(member.userId, session.user.id), with: { organization: true } });
  return {
    activeOrganizationId: session.session.activeOrganizationId ?? null,
    organizations: rows.map(row => ({ id: row.organizationId, name: row.organization.name, slug: row.organization.slug, role: row.role })),
  };
}
