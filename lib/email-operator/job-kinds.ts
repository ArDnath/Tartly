/** Job kinds shared between producers and handlers (no imports → no cycles). */
export const JOB_KIND_INBOUND_EMAIL = "inbound_email";
export const JOB_KIND_FOLLOWUP = "followup";
/**
 * Pull new mail from Gmail into the mirror, then hand it to the triage flow.
 * This is the step "Sync now" was missing: `inbound_email` only re-processes
 * threads already mirrored, so nothing ever fetched mail unless Pub/Sub or the
 * daily cron happened to run.
 */
export const JOB_KIND_MAILBOX_SYNC = "mailbox_sync";
/**
 * A confirmed `schedule_email` action firing at its `runAfter`. The pending
 * action is the user's consent; the send itself goes through the same
 * idempotent `SendService`/ledger path as an immediate send, keyed by the
 * action's server-derived idempotency key, so a double-fire sends once.
 */
export const JOB_KIND_SCHEDULED_EMAIL = "scheduled_email";
/**
 * One throttled batch of a bulk campaign (Phase 7). The handler claims a bounded
 * batch of pending recipients, sends each through the idempotent `sendEmail`
 * path, then re-enqueues itself with a delay until the campaign is done or
 * paused. No long-lived worker.
 */
export const JOB_KIND_BULK_SEND = "bulk_send";
