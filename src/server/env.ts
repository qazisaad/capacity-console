import { z } from "zod";

const base64Key = z.string().refine(value => {
  try { return Buffer.from(value, "base64").length === 32; } catch { return false; }
}, "Expected a base64-encoded 32-byte key");

export const envSchema = z.object({
  APP_ORIGIN: z.url().refine(value => { const url = new URL(value); return !url.search && !url.hash && url.pathname === "/"; }, "APP_ORIGIN must be a bare origin"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  CREDENTIAL_ENCRYPTION_KEY: base64Key,
  CREDENTIAL_ENCRYPTION_KEY_ID: z.string().min(1).max(32).default("k1"),
  CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: base64Key.optional(),
  CREDENTIAL_ENCRYPTION_KEY_PREVIOUS_ID: z.string().min(1).max(32).optional(),
  BOOTSTRAP_TOKEN: z.string().min(16).optional(),
  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});
export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;
/** Parse process.env once. Missing configuration fails fast at startup instead of producing a silent fallback. */
export function env(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) throw new Error(`Invalid configuration: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    cached = parsed.data;
  }
  return cached;
}
export function resetEnvForTests(): void { cached = undefined; }
export function isSecureOrigin(origin: string): boolean { return new URL(origin).protocol === "https:"; }
