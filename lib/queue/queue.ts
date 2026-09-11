import "server-only";

import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

/**
 * Durable Postgres queue.
 *
 * Ported from DeskcommCRM's `job_queue` primitives (`lib/agent-engine/queue`),
 * trimmed to what the email operator needs: enqueue, claim, complete, fail,
 * cancel and reap. `FOR UPDATE SKIP LOCKED` plus a partial unique index
 * (`one running per lane`) means concurrent drains never process the same
 * thread twice, and crons may double-fire safely.
 */

export type JobStatus = "pending" | "running" | "done" | "failed" | "dead";

export type JobRow = {
  id: string;
  userId: string;
  laneKey: string | null;
  kind: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: number;
  runAfter: Date;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  lockedBy: string | null;
  lockedAt: Date | null;
  sourceEventId: string | null;
  claimAcquiredAt?: string;
  createdAt: Date;
};

/** Minimal surface shared by `pg.Pool` and `pg.PoolClient`. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

// Serializes claimers so the global running-cap can never be exceeded by a race.
const CLAIM_LOCK_KEY = 727258;

type RawJobRow = {
  id: string;
  user_id: string;
  lane_key: string | null;
  kind: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: number;
  run_after: Date;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  locked_by: string | null;
  locked_at: Date | null;
  source_event_id: string | null;
  claim_acquired_at?: string;
  created_at: Date;
};

function toJobRow(row: RawJobRow): JobRow {
  return {
    id: row.id,
    userId: row.user_id,
    laneKey: row.lane_key,
    kind: row.kind,
    payload: row.payload,
    status: row.status,
    priority: row.priority,
    runAfter: row.run_after,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
    sourceEventId: row.source_event_id,
    claimAcquiredAt: row.claim_acquired_at,
    createdAt: row.created_at,
  };
}

export type EnqueueInput = {
  kind: string;
  laneKey?: string | null;
  payload?: Record<string, unknown>;
  priority?: number;
  runAfter?: Date;
  maxAttempts?: number;
  sourceEventId?: string | null;
};

/**
 * Inserts a job. `sourceEventId` dedupes event→job (unique per user): an
 * at-least-once redelivery returns the same row with `deduped: true`.
 */
export async function enqueueJob(
  db: Queryable,
  userId: string,
  input: EnqueueInput,
): Promise<{ job: JobRow; deduped: boolean }> {
  const id = `job_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

  try {
    const { rows } = await db.query<RawJobRow>(
      `insert into job_queue
         (id, user_id, lane_key, kind, payload, priority, run_after, max_attempts, source_event_id)
       values ($1,$2,$3,$4,$5,
               coalesce($6::int, 100),
               coalesce($7::timestamptz, now()),
               coalesce($8::int, 5),
               $9)
       returning *`,
      [
        id,
        userId,
        input.laneKey ?? null,
        input.kind,
        input.payload ?? {},
        input.priority ?? null,
        input.runAfter ?? null,
        input.maxAttempts ?? null,
        input.sourceEventId ?? null,
      ],
    );
    return { job: toJobRow(rows[0]), deduped: false };
  } catch (error) {
    if (!isUniqueViolation(error) || input.sourceEventId == null) throw error;
    const { rows } = await db.query<RawJobRow>(
      "select * from job_queue where user_id = $1 and source_event_id = $2",
      [userId, input.sourceEventId],
    );
    return { job: toJobRow(rows[0]), deduped: true };
  }
}

const CLAIM_SQL = `
  with dedup as (
    select distinct on (coalesce(j.lane_key, j.id)) j.id
    from job_queue j
    where j.status = 'pending' and j.run_after <= now()
      and (j.lane_key is null
           or not exists (select 1 from job_queue r
                          where r.lane_key = j.lane_key and r.status = 'running'))
    order by coalesce(j.lane_key, j.id), j.priority, j.run_after
  ),
  runnable as (
    select j.id from job_queue j
    join dedup d on d.id = j.id
    where j.status = 'pending'
    order by j.priority, j.run_after
    limit $1
    for update of j skip locked
  )
  update job_queue
  set status = 'running', locked_by = $2, locked_at = now(), attempts = attempts + 1
  where id in (select id from runnable)
  returning *, locked_at::text as claim_acquired_at`;

export type ClaimOptions = {
  workerId: string;
  /** Global cap on simultaneous `running` jobs. */
  maxConcurrency: number;
  batchSize?: number;
};

export async function claimJobs(
  pool: Pool,
  opts: ClaimOptions,
): Promise<JobRow[]> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1)", [CLAIM_LOCK_KEY]);
    const running = await client.query<{ n: number }>(
      "select count(*)::int as n from job_queue where status = 'running'",
    );
    const free = Math.min(
      opts.batchSize ?? opts.maxConcurrency,
      opts.maxConcurrency - (running.rows[0]?.n ?? 0),
    );
    if (free <= 0) {
      await client.query("rollback");
      return [];
    }
    const { rows } = await client.query<RawJobRow>(CLAIM_SQL, [
      free,
      opts.workerId,
    ]);
    await client.query("commit");
    return rows.map(toJobRow);
  } catch (error) {
    await rollback(client, error);
    if (isUniqueViolation(error)) return []; // residual lane race loses one round
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Completes a job inside a transaction. `inSameCommit` lets the caller write
 * state in the same commit as the terminal status. If the lease was lost
 * (reaper revived the job and another worker re-claimed it) nothing commits.
 */
export async function completeJob<T = void>(
  pool: Pool,
  jobId: string,
  workerId: string,
  inSameCommit?: (tx: PoolClient) => Promise<T>,
  acquiredAt?: string,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = (inSameCommit ? await inSameCommit(client) : undefined) as T;
    const done = await client.query(
      `update job_queue set status = 'done', locked_by = null, locked_at = null
       where id = $1 and status = 'running' and locked_by = $2
         and ($3::timestamptz is null or locked_at = $3)`,
      [jobId, workerId, acquiredAt ?? null],
    );
    if (done.rowCount !== 1) {
      throw new Error(
        `lease for job ${jobId} was lost before completion — effects discarded`,
      );
    }
    await client.query("commit");
    return result;
  } catch (error) {
    await rollback(client, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Returns a failed job to the queue with exponential backoff
 * (10s, 20s, 40s, 80s, capped at 120s). Exhausting `max_attempts` marks it
 * `dead`. Returns null when the lease is no longer this worker's.
 */
export async function failJob(
  db: Queryable,
  jobId: string,
  workerId: string,
  error: unknown,
  acquiredAt?: string,
): Promise<JobRow | null> {
  const { rows } = await db.query<RawJobRow>(
    `update job_queue
     set status = case when attempts >= max_attempts then 'dead' else 'pending' end,
         run_after = case
           when attempts >= max_attempts then run_after
           else now() + (least(power(2, greatest(attempts - 1, 0)) * 10, 120) * interval '1 second')
         end,
         locked_by = null, locked_at = null, last_error = $3
     where id = $1 and status = 'running' and locked_by = $2
       and ($4::timestamptz is null or locked_at = $4)
     returning *`,
    [jobId, workerId, normalizeError(error), acquiredAt ?? null],
  );
  return rows[0] ? toJobRow(rows[0]) : null;
}

/** Terminal cancellation for a permanent business veto (no retry, no dead). */
export async function cancelJob(
  db: Queryable,
  jobId: string,
  workerId: string,
  reason: string,
  acquiredAt?: string,
): Promise<JobRow | null> {
  const { rows } = await db.query<RawJobRow>(
    `update job_queue
     set status = 'failed', locked_by = null, locked_at = null, last_error = $3
     where id = $1 and status = 'running' and locked_by = $2
       and ($4::timestamptz is null or locked_at = $4)
     returning *`,
    [jobId, workerId, normalizeError(reason), acquiredAt ?? null],
  );
  return rows[0] ? toJobRow(rows[0]) : null;
}

/**
 * Reaper: a `running` job older than the visibility timeout belongs to a dead
 * worker. It returns to `pending` (or `dead` when attempts are exhausted).
 */
export async function reapExpiredJobs(
  db: Queryable,
  opts: { visibilityTimeoutMs: number },
): Promise<{ revived: number; dead: number }> {
  const { rows } = await db.query<{ id: string; status: JobStatus }>(
    `update job_queue
     set status = case when attempts >= max_attempts then 'dead' else 'pending' end,
         locked_by = null, locked_at = null,
         last_error = coalesce(last_error, 'visibility timeout exceeded (dead worker?)')
     where status = 'running'
       and locked_at < now() - ($1 * interval '1 millisecond')
     returning id, status`,
    [opts.visibilityTimeoutMs],
  );
  return {
    revived: rows.filter((r) => r.status === "pending").length,
    dead: rows.filter((r) => r.status === "dead").length,
  };
}

/** Milliseconds until the next claimable job, or null when none is pending. */
export async function msUntilNextJob(pool: Pool): Promise<number | null> {
  const { rows } = await pool.query<{ ms: number | null }>(
    `select case
              when min(run_after) is null then null
              else greatest(
                     extract(epoch from (
                       least(min(run_after), now() + interval '1 day') - now()
                     )) * 1000,
                     0
                   )::int
            end as ms
       from job_queue
      where status = 'pending'`,
  );
  return rows[0]?.ms ?? null;
}

/** Truncated first line only: error rows must never carry message content. */
function normalizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (message.split("\n", 1)[0] ?? "").slice(0, 300);
}

async function rollback(client: PoolClient, cause: unknown): Promise<void> {
  try {
    await client.query("rollback");
  } catch (rollbackError) {
    throw new AggregateError(
      [cause, rollbackError],
      "rollback failed after an error in the queue transaction",
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
