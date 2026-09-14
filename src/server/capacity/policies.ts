import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/context";
import { capacityPolicies } from "../db/schema";
import { recordAudit } from "../audit";
import { randomId } from "../secrets";
import { AuthorizationError, type Principal } from "../auth/session";
import { capacityPolicySchema, type CapacityPolicy } from "./policy";

export type PolicyRevision = { revision: number; policy: CapacityPolicy; createdAt: string; createdByUserId: string | null };

export async function activePolicy(organizationId: string): Promise<PolicyRevision> {
  const row = await db().query.capacityPolicies.findFirst({ where: and(eq(capacityPolicies.organizationId, organizationId), eq(capacityPolicies.active, true)) });
  if (!row) return { revision: 0, policy: capacityPolicySchema.parse({}), createdAt: new Date(0).toISOString(), createdByUserId: null };
  return { revision: row.revision, policy: capacityPolicySchema.parse(row.policy), createdAt: row.createdAt.toISOString(), createdByUserId: row.createdByUserId };
}

export async function policyHistory(organizationId: string, limit = 20): Promise<PolicyRevision[]> {
  const rows = await db().select().from(capacityPolicies).where(eq(capacityPolicies.organizationId, organizationId)).orderBy(desc(capacityPolicies.revision)).limit(limit);
  return rows.map(row => ({ revision: row.revision, policy: capacityPolicySchema.parse(row.policy), createdAt: row.createdAt.toISOString(), createdByUserId: row.createdByUserId }));
}

export const updatePolicyInputSchema = z.object({ expectedRevision: z.number().int().nonnegative(), policy: capacityPolicySchema });

/** Every edit is a new immutable revision. A stale expectedRevision is a conflict; the caller must refresh. */
export async function updatePolicy(principal: Principal, input: z.infer<typeof updatePolicyInputSchema>): Promise<PolicyRevision> {
  const data = updatePolicyInputSchema.parse(input);
  if (!["owner", "admin"].includes(principal.role)) throw new AuthorizationError(403, "Only owners and admins change policy.");
  return db().transaction(async tx => {
    const [current] = await tx.select().from(capacityPolicies).where(and(eq(capacityPolicies.organizationId, principal.organizationId), eq(capacityPolicies.active, true))).for("update");
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== data.expectedRevision) throw new AuthorizationError(409, `Policy changed to revision ${currentRevision}. Refresh and retry.`);
    if (current) await tx.update(capacityPolicies).set({ active: false }).where(eq(capacityPolicies.id, current.id));
    const [next] = await tx.insert(capacityPolicies).values({ id: randomId(), organizationId: principal.organizationId, revision: currentRevision + 1, policy: data.policy, active: true, createdByUserId: principal.userId }).returning();
    await recordAudit(tx, { organizationId: principal.organizationId, actorUserId: principal.userId, kind: "policy.updated", subjectType: "capacity_policy", subjectId: String(next!.revision), details: { policy: data.policy, previousRevision: currentRevision } });
    return { revision: next!.revision, policy: capacityPolicySchema.parse(next!.policy), createdAt: next!.createdAt.toISOString(), createdByUserId: next!.createdByUserId };
  });
}
