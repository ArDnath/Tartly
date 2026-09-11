import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

/**
 * Raw pool, also exported for the durable queue: `FOR UPDATE SKIP LOCKED` and
 * advisory locks are not expressible through the query builder, so the queue
 * primitives talk to Postgres directly (same pool as the ORM).
 *
 * Sized to survive a few concurrent page renders plus the opportunistic drain
 * without queueing behind an idle worker, and recycles idle sockets so a
 * scale-to-zero database (Neon/Supabase) can suspend.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 12,
  idleTimeoutMillis: 30_000,
  // A scale-to-zero Postgres (Neon/Supabase) can take several seconds to resume
  // and accept a fresh socket. This is a ceiling, not a delay: a warm pool is
  // unaffected, while a cold start no longer fails the first request.
  connectionTimeoutMillis: 15_000,
  allowExitOnIdle: false,
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;
