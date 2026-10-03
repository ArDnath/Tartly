# Runbook — Send succeeded, no mirror row

**Symptom:** `reconcile_drift > 0`; the daily cron reports
`sendMirrorMissing > 0`. A reply was delivered by Gmail but the local
`messages` mirror has no matching outbound row.

## Why it is safe

`send_ledger.idempotency_key` is unique. A retry cannot re-send: `sendEmail`
returns `deduped: true` without calling Gmail. The drift is cosmetic, not a
double-send.

## Steps

1. Confirm the ledger row exists and is `accepted`:
   ```sql
   select idempotency_key, status, created_at
   from send_ledger
   where idempotency_key like 'run:%'
   order by created_at desc limit 20;
   ```
2. Run reconciliation (the daily cron does this automatically; to force it,
   trigger `/api/v1/cron/daily`).
3. If the mirror row is still missing, the thread view will not show the reply
   until the next sync. Trigger a mailbox sync (`POST /api/v1/inbox/sync`) or
   wait for the daily backfill.
4. If the Gmail message truly cannot be found, treat it as needs-attention and
   leave the ledger row in place — it is the record of the at-most-once send.

**Do not** delete the ledger row; that would allow a duplicate send.
