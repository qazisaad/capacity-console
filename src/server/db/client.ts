import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function createDb(connectionString: string, options: { max?: number } = {}): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10, connectionTimeoutMillis: 10_000 });
  return { db: drizzle(pool, { schema, casing: "snake_case" }), pool };
}
