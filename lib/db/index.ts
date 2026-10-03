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

function poolConfig(connectionString: string | undefined) {
  return {
    connectionString,
    max: dbPoolMax(),
    idleTimeoutMillis: 30_000,
    // A scale-to-zero Postgres (Neon/Supabase) can take several seconds to
    // resume and accept a fresh socket. This is a ceiling, not a delay: a warm
    // pool is unaffected, while a cold start no longer fails the first request.
    connectionTimeoutMillis: 15_000,
    allowExitOnIdle: false,
  } as const;
}

export const pool = new Pool(poolConfig(process.env.DATABASE_URL));

/**
 * Optional read replica (Phase D3). When `DATABASE_REPLICA_URL` is unset this
 * aliases the primary pool, so nothing changes. When set, a read-heavy
 * repository can be constructed with `readDb` to offload SELECTs; the caller is
 * responsible for handling replication lag (never read-your-writes from the
 * replica). See `docs/runbooks/scaling-and-connections.md`.
 */
const replicaUrl = process.env.DATABASE_REPLICA_URL?.trim();
export const readPool =
  replicaUrl && replicaUrl.length > 0
    ? new Pool(poolConfig(replicaUrl))
    : pool;

export const db = drizzle(pool, { schema });

export const readDb = replicaUrl ? drizzle(readPool, { schema }) : db;

export type Database = typeof db;

/**
 * Cheap liveness ping for the readiness probe (`select 1`). Kept here so the
 * only place that talks to Postgres outside the repository layer is `lib/db`
 * itself.
 */
export async function pingDatabase(): Promise<void> {
  await pool.query("select 1");
}

/**
 * Closes the primary pool (and the replica pool when it is distinct). Call this
 * last in a graceful shutdown, after workers have stopped claiming jobs.
 */
export async function closeDatabasePools(): Promise<void> {
  const closers: Promise<void>[] = [pool.end()];
  if (readPool !== pool) closers.push(readPool.end());
  await Promise.all(closers);
}
