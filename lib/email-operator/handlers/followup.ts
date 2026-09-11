import "server-only";

import { JOB_KIND_FOLLOWUP } from "@/lib/email-operator/job-kinds";
import type { JobHandler } from "@/lib/email-operator/jobs";
import { processFollowupEnrollment } from "@/lib/followup/service";
import type { JobRow } from "@/lib/queue/queue";

/**
 * `followup` handler: advances one due enrollment (drafts a nudge, reschedules
 * or completes). Enqueued by the `followups` cron / daily fan-out.
 */
async function handleFollowup(job: JobRow): Promise<void> {
  const enrollmentId =
    typeof job.payload.enrollmentId === "string"
      ? job.payload.enrollmentId
      : null;
  if (!enrollmentId) return;

  const result = await processFollowupEnrollment(enrollmentId);
  if (!result) {
    console.warn(`[followup] enrollment ${enrollmentId} not found`);
  }
}

export const followupHandler: { kind: string; handler: JobHandler } = {
  kind: JOB_KIND_FOLLOWUP,
  handler: handleFollowup,
};
