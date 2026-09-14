import type pg from "pg";
import { env } from "../env";
import { createDb, type Db } from "./client";

let current: { db: Db; pool: pg.Pool } | undefined;
/** Process-wide database handle. Tests replace it through `setDbForTests`. */
export function db(): Db {
  if (!current) current = createDb(env().DATABASE_URL);
  return current.db;
}
export function pool(): pg.Pool {
  if (!current) current = createDb(env().DATABASE_URL);
  return current.pool;
}
export function setDbForTests(handle: { db: Db; pool: pg.Pool } | undefined): void { current = handle; }
export async function closeDb(): Promise<void> { const handle = current; current = undefined; await handle?.pool.end(); }
