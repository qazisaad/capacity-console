import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { env, isSecureOrigin } from "../env";
import { db } from "../db/context";
import type { Db, Tx } from "../db/client";
import * as schema from "../db/schema";
import { randomToken } from "../secrets";
import { ac, roles } from "./access";

/** Random per-process marker. Only server code that has verified a bootstrap token or invitation may create an account. */
export const INTERNAL_SIGNUP_HEADER = "x-capacity-internal-signup";
export const internalSignupMarker: string = randomToken(32);

export const INVITATION_TTL_SECONDS = 7 * 24 * 3600;

function build(handle: Db | Tx = db()) {
  const e = env();
  return betterAuth({
    appName: "Capacity Console",
    baseURL: e.APP_ORIGIN,
    secret: e.BETTER_AUTH_SECRET,
    trustedOrigins: [e.APP_ORIGIN],
    telemetry: { enabled: false },
    database: drizzleAdapter(handle, { provider: "pg", schema }),
    emailAndPassword: { enabled: true, requireEmailVerification: false, minPasswordLength: 12, autoSignIn: true },
    advanced: { useSecureCookies: isSecureOrigin(e.APP_ORIGIN), cookiePrefix: "capacity" },
    hooks: {
      before: createAuthMiddleware(async ctx => {
        if (ctx.path === "/sign-up/email" && ctx.headers?.get(INTERNAL_SIGNUP_HEADER) !== internalSignupMarker) {
          throw new APIError("FORBIDDEN", { message: "Public sign-up is closed. Use an invitation link." });
        }
      }),
    },
    plugins: [
      organization({
        ac, roles,
        allowUserToCreateOrganization: true,
        invitationExpiresIn: INVITATION_TTL_SECONDS,
        cancelPendingInvitationsOnReInvite: true,
        // Without SMTP, administrators copy the link from the UI. Tokens are never logged.
        sendInvitationEmail: async () => {},
      }),
      tanstackStartCookies(),
    ],
  });
}

let instance: ReturnType<typeof build> | undefined;
export function auth(): ReturnType<typeof build> {
  if (!instance) instance = build();
  return instance;
}
export function resetAuthForTests(): void { instance = undefined; }
export function transactionalAuth(handle: Tx): ReturnType<typeof build> { return build(handle); }

/** Organization mutations must pass through app-owned transactions and audit boundaries. */
export function handleAuthRequest(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "");
  if (!["/get-session", "/sign-in/email", "/sign-out", "/sign-up/email"].includes(path)) {
    return Promise.resolve(Response.json({ error: "Use the application account-management flow." }, { status: 403 }));
  }
  return auth().handler(request);
}
export type Auth = ReturnType<typeof build>;
