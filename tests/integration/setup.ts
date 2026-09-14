// Integration tests run against a real PostgreSQL. Default matches scripts/dev-db.sh; override with TEST_DATABASE_URL.
import { beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54329/capacity_test";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3999";
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "test-secret-test-secret-test-secret-0000";
process.env.CREDENTIAL_ENCRYPTION_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");

/** Drop everything and re-run the committed migrations so each file starts from the real schema. */
export async function resetDatabase(): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query("drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;");
    await migrate(drizzle(client), { migrationsFolder: resolve(fileURLToPath(new URL(".", import.meta.url)), "../../drizzle") });
  } finally { await client.end(); }
}

beforeAll(async () => { await resetDatabase(); });
afterAll(async () => {
  const { closeDb } = await import("~/server/db/context");
  await closeDb();
});
