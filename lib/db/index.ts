import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

/**
 * Raw pool, also exported for the durable queue: `FOR UPDATE SKIP LOCKED` and
 * advisory locks are not expressible through the query builder, so the queue
 * primitives talk to Postgres directly (same pool as the ORM).
 *
 * Size is per function instance, so serverless concurrency comes from instance
 * count, not a big pool: default 5, override with `DB_POOL_MAX`. Always point
 * `DATABASE_URL` at a pooled endpoint (Neon `-pooler` / Supavisor / PgBouncer)
 * so the provider bounds total connections. Idle sockets are recycled so a
 * scale-to-zero database (Neon/Supabase) can suspend.
 *
 * Read straight from `process.env` (not `lib/env`) so importing the pool from a
 * script does not trigger full app env validation.
 */
const DEFAULT_DB_POOL_MAX = 5;

function dbPoolMax(): number {
  const parsed = Number(process.env.DB_POOL_MAX);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_DB_POOL_MAX;
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: dbPoolMax(),
  idleTimeoutMillis: 30_000,
  // A scale-to-zero Postgres (Neon/Supabase) can take several seconds to resume
  // and accept a fresh socket. This is a ceiling, not a delay: a warm pool is
  // unaffected, while a cold start no longer fails the first request.
  connectionTimeoutMillis: 15_000,
  allowExitOnIdle: false,
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;
