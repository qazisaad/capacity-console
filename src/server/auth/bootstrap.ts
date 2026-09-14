import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/context";
import { installation } from "../db/schema";
import { env } from "../env";
import { recordAudit } from "../audit";
import { digest, digestMatches } from "../secrets";
import { transactionalAuth, INTERNAL_SIGNUP_HEADER, internalSignupMarker } from "./auth";
import { AuthorizationError } from "./session";

export const bootstrapInputSchema = z.object({
  token: z.string().min(16).max(512),
  email: z.email().max(254),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(256),
});
export type BootstrapInput = z.infer<typeof bootstrapInputSchema>;

/** Create the single installation row from the configured bootstrap token if it does not exist yet. */
export async function ensureInstallation(): Promise<{ bootstrapOpen: boolean }> {
  const existing = await db().query.installation.findFirst();
  if (existing) return { bootstrapOpen: existing.bootstrapConsumedAt === null };
  const token = env().BOOTSTRAP_TOKEN;
  if (!token) return { bootstrapOpen: false };
  await db().insert(installation).values({ id: 1, bootstrapTokenHash: digest(token) }).onConflictDoNothing();
  return { bootstrapOpen: true };
}

export async function installationStatus(): Promise<{ initialized: boolean; bootstrapOpen: boolean }> {
  const row = await db().query.installation.findFirst();
  if (!row) return { initialized: false, bootstrapOpen: false };
  return { initialized: true, bootstrapOpen: row.bootstrapConsumedAt === null };
}

/**
 * Create the first administrator. The installation row is locked for the whole operation so two
 * concurrent requests cannot both succeed; the second sees the consumed marker after the first commits.
 */
export async function bootstrapAdmin(input: BootstrapInput): Promise<{ userId: string; cookies: string[] }> {
  const data = bootstrapInputSchema.parse(input);
  return db().transaction(async tx => {
    const [row] = await tx.select().from(installation).where(eq(installation.id, 1)).for("update");
    if (!row) throw new AuthorizationError(409, "This installation has no bootstrap token. Run setup first.");
    if (row.bootstrapConsumedAt) throw new AuthorizationError(409, "Bootstrap has already been completed.");
    if (!digestMatches(data.token, row.bootstrapTokenHash)) throw new AuthorizationError(403, "Invalid bootstrap token.");
    const result = await transactionalAuth(tx).api.signUpEmail({
      body: { email: data.email, password: data.password, name: data.name },
      headers: new Headers({ [INTERNAL_SIGNUP_HEADER]: internalSignupMarker }),
      returnHeaders: true,
    });
    const userId = result.response.user.id;
    await tx.update(installation).set({ bootstrapConsumedAt: sql`now()`, bootstrapUserId: userId }).where(eq(installation.id, 1));
    await recordAudit(tx, { actorUserId: userId, kind: "installation.bootstrapped", subjectType: "user", subjectId: userId });
    return { userId, cookies: result.headers.getSetCookie() };
  });
}
