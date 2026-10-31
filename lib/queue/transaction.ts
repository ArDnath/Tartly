import type { Pool, PoolClient } from "pg";

/**
 * Transactional unit for durable-queue mutations.
 *
 * Claim + lease checks and completion/failure updates all run inside one
 * transaction so a lease-loss (reaper revived the job, another worker re-claimed
 * it) can never commit a stale outcome.
 */
export async function withJobTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await rollback(client, error);
    throw error;
  } finally {
    client.release();
  }
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
