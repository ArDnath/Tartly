# Runbook — Poison job

**Symptom:** `job_queue` rows reach `status = 'dead'`; `job_dead` increases;
`/activity` shows dead jobs.

## Steps

1. Inspect without dumping content:
   ```sql
   select id, kind, attempts, max_attempts, left(last_error, 200) as last_error, created_at
   from job_queue
   where status = 'dead'
   order by created_at desc
   limit 50;
   ```
2. Identify the failing `kind`. The built-ins are `inbound_email`, `followup`,
   `mailbox_sync`, `scheduled_email`, `bulk_send`.
3. Fix the root cause (a bad handler, a malformed payload, a provider outage).
4. Requeue via the operator script (never a public route):
   ```bash
   npx tsx scripts/email-operator/requeue-dead.ts --user <userId> --kind inbound_email
   ```
   Requeueing is safe: handlers are idempotent on their `sourceEventId` and the
   send path is guarded by `send_ledger`.

**Escalate if:** the same job dies repeatedly after a fix — the payload may
reference a deleted thread/mailbox.
