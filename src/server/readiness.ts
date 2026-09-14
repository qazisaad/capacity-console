import { sql } from "drizzle-orm";
import { db } from "./db/context";
import { schemaStatus } from "./db/schema-version";
import { env } from "./env";
import { runtimeState } from "./runtime-state";

/** Readiness never reveals secrets or tenant data. */
export async function readiness(): Promise<{ ready: boolean; checks: Record<string, boolean | number | null> }> {
  const checks: Record<string, boolean | number | null> = { configuration: false, database: false, schema: false, lease: false };
  try { env(); checks.configuration = true; } catch { /* reported as false */ }
  let schema = { ok: false, applied: null as number | null, expected: 0 };
  if (checks.configuration) {
    try { await db().execute(sql`select 1`); checks.database = true; schema = await schemaStatus(db()); } catch { /* reported as false */ }
  }
  checks.schema = schema.ok; checks.schemaApplied = schema.applied; checks.schemaExpected = schema.expected;
  checks.lease = runtimeState.leaseHeld;
  return { ready: Object.values({ c: checks.configuration, d: checks.database, s: checks.schema, l: checks.lease }).every(Boolean), checks };
}
