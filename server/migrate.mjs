// One-shot, lock-protected migration. The app process never mutates the schema on its own.
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required."); process.exit(2); }
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("select pg_advisory_lock(hashtext('capacity_console_migrate'))");
  await migrate(drizzle(client), { migrationsFolder: resolve(fileURLToPath(new URL(".", import.meta.url)), "../drizzle") });
  const { rows } = await client.query("select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1");
  console.log(`Migrations applied. Schema version ${rows[0]?.created_at ?? "none"}.`);
  await client.query("select pg_advisory_unlock(hashtext('capacity_console_migrate'))");
} finally { await client.end(); }
