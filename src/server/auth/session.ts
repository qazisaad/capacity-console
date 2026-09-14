import { and, eq } from "drizzle-orm";
import { db } from "../db/context";
import { member } from "../db/schema";
import { auth } from "./auth";
import { isRole, type Role } from "./access";

export class AuthorizationError extends Error {
  constructor(readonly status: 401 | 403 | 409, message: string) { super(message); }
}

export type Principal = {
  userId: string; email: string; name: string;
  organizationId: string; memberId: string; role: Role;
};

/** Resolve the caller's session and current membership in the active organization, server-side, on every call. */
export async function requireSession(headers: Headers) {
  const session = await auth().api.getSession({ headers });
  if (!session) throw new AuthorizationError(401, "Sign in required.");
  return session;
}

export async function requirePrincipal(headers: Headers, allowed?: readonly Role[]): Promise<Principal> {
  const session = await requireSession(headers);
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) throw new AuthorizationError(409, "Select an organization first.");
  const row = await db().query.member.findFirst({ where: and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)) });
  if (!row || !isRole(row.role)) throw new AuthorizationError(403, "You are not a member of the selected organization.");
  if (allowed && !allowed.includes(row.role)) throw new AuthorizationError(403, "Your role does not permit this operation.");
  return { userId: session.user.id, email: session.user.email, name: session.user.name, organizationId, memberId: row.id, role: row.role };
}
