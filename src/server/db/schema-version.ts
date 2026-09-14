import { sql } from "drizzle-orm";
import journal from "../../../drizzle/meta/_journal.json";
import type { Db } from "./client";

/** The schema the running code was built against: the last journal entry's timestamp. */
export const EXPECTED_SCHEMA_VERSION: number = journal.entries.at(-1)?.when ?? 0;

/** Readiness: the database must carry exactly the migration set this build knows about. */
export async function schemaStatus(db: Db): Promise<{ ok: boolean; applied: number | null; expected: number }> {
  try {
    const rows = await db.execute<{ created_at: string | number }>(sql`select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`);
    const applied = rows.rows[0] ? Number(rows.rows[0].created_at) : null;
    return { ok: applied === EXPECTED_SCHEMA_VERSION, applied, expected: EXPECTED_SCHEMA_VERSION };
  } catch { return { ok: false, applied: null, expected: EXPECTED_SCHEMA_VERSION }; }
}
