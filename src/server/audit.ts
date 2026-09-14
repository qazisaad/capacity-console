import { auditEvents } from "./db/schema";
import type { Db, Tx } from "./db/client";

export type AuditInput = {
  organizationId?: string | null; actorUserId?: string | null;
  kind: string; subjectType: string; subjectId: string; details?: Record<string, unknown>;
};
/** Write an audit event in the same transaction as the change it describes. Never pass secrets in `details`. */
export async function recordAudit(tx: Tx | Db, input: AuditInput): Promise<void> {
  await tx.insert(auditEvents).values({
    organizationId: input.organizationId ?? null, actorUserId: input.actorUserId ?? null,
    kind: input.kind, subjectType: input.subjectType, subjectId: input.subjectId, details: input.details ?? {},
  });
}
