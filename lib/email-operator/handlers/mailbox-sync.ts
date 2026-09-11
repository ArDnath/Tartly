import "server-only";

import { pool } from "@/lib/db";
import {
  JOB_KIND_INBOUND_EMAIL,
  JOB_KIND_MAILBOX_SYNC,
} from "@/lib/email-operator/job-kinds";
import type { JobHandler } from "@/lib/email-operator/jobs";
import { getMailboxForUserById } from "@/lib/email-operator/mailbox";
import { syncMailbox } from "@/lib/gmail/sync";
import { enqueueJob, type JobRow } from "@/lib/queue/queue";

/**
 * `mailbox_sync` handler: the missing step between a connected mailbox and
 * triage. It (1) pulls new mail from Gmail into the Postgres mirror and then
 * (2) enqueues `inbound_email` so the newly-mirrored threads get classified and
 * drafted. Producers: onboarding bootstrap, "Sync now", and the self-heal path.
 */
async function handleMailboxSync(job: JobRow): Promise<void> {
  const mailboxId =
    typeof job.payload.mailboxId === "string" ? job.payload.mailboxId : null;
  if (!mailboxId) return;

  const mailbox = await getMailboxForUserById(job.userId, mailboxId);
  if (!mailbox) return;

  // 1) Pull new mail from Gmail into the mirror (the step that was missing).
  await syncMailbox(job.userId, mailboxId);

  // 2) Hand the newly-mirrored threads to the triage/draft flow. `Date.now()`
  // keeps a later manual sync from being deduped against an earlier run, while
  // the lane serializes the two jobs so triage never races its own sync.
  await enqueueJob(pool, job.userId, {
    kind: JOB_KIND_INBOUND_EMAIL,
    laneKey: `mailbox:${mailboxId}`,
    payload: { mailboxId },
    sourceEventId: `post-sync:${mailboxId}:${Date.now()}`,
  });
}

export const mailboxSyncHandler: { kind: string; handler: JobHandler } = {
  kind: JOB_KIND_MAILBOX_SYNC,
  handler: handleMailboxSync,
};
