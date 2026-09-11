import "server-only";

import { JOB_KIND_SCHEDULED_EMAIL } from "@/lib/email-operator/job-kinds";
import type { JobHandler } from "@/lib/email-operator/jobs";
import type { JobRow } from "@/lib/queue/queue";
import { scheduleService } from "@/lib/services/schedule-service";

/**
 * `scheduled_email` handler: fire one due scheduled send.
 *
 * The job is a *trigger*, not the consent. Consent is the confirmed pending
 * action the schedule points at; this handler only performs the already-agreed
 * send, idempotently, through the shared send path.
 */
async function handleScheduledEmail(job: JobRow): Promise<void> {
  const scheduledActionId =
    typeof job.payload.scheduledActionId === "string"
      ? job.payload.scheduledActionId
      : null;
  if (!scheduledActionId) return;

  await scheduleService.processScheduledAction({ scheduledActionId });
}

export const scheduledEmailHandler: { kind: string; handler: JobHandler } = {
  kind: JOB_KIND_SCHEDULED_EMAIL,
  handler: handleScheduledEmail,
};
