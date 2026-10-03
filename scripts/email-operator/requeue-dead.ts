import "dotenv/config";

import { pool } from "../../lib/db";

/**
 * Admin requeue for `dead` jobs (§9.4). Deliberately a script, not a public
 * route: it mutates queue state and must be run with operator intent.
 *
 * Usage:
 *   npx tsx scripts/email-operator/requeue-dead.ts --user <userId> [--kind inbound_email]
 *   npx tsx scripts/email-operator/requeue-dead.ts --all
 *
 * Safe to repeat: handlers are idempotent on their `sourceEventId`, and sends
 * remain guarded by `send_ledger`.
 */
async function main() {
  const args = process.argv.slice(2);
  const user = valueOf(args, "--user");
  const kind = valueOf(args, "--kind");
  const all = args.includes("--all");

  if (!user && !all) {
    console.error("Provide --user <userId> or --all.");
    process.exit(1);
  }

  const conditions: string[] = ["status = 'dead'"];
  const params: unknown[] = [];
  if (user) {
    params.push(user);
    conditions.push(`user_id = $${params.length}`);
  }
  if (kind) {
    params.push(kind);
    conditions.push(`kind = $${params.length}`);
  }

  const result = await pool.query(
    `update job_queue
        set status = 'pending',
            attempts = 0,
            locked_by = null,
            locked_at = null,
            last_error = null,
            run_after = now()
      where ${conditions.join(" and ")}`,
    params,
  );

  console.log(`Requeued ${result.rowCount ?? 0} dead job(s).`);
  await pool.end();
}

function valueOf(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
