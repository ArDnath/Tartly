import "server-only";

import { invalidateBriefing } from "@/lib/briefing/service";
import { mailboxRepository } from "@/lib/repositories/mailboxes";
import { assistantSettingsRepository } from "@/lib/repositories/assistant-settings";
import { getAutopilotPolicyForMailbox } from "@/lib/settings/autopilot";
import { getOvernightSummary } from "@/lib/settings/autopilot-usage";

/**
 * Finalizes the overnight review: for every mailbox with autopilot + morning
 * review enabled, if there was activity in the send window, invalidate the
 * cached briefing so the next open shows it, and stamp the review time.
 *
 * Idempotent and bounded. Never sends. On Hobby this runs from the daily cron.
 */

export type AutopilotReviewSummary = {
  usersChecked: number;
  reviewsFinalized: number;
  sent: number;
  drafted: number;
};

export async function runAutopilotReview(
  now = new Date(),
): Promise<AutopilotReviewSummary> {
  const summary: AutopilotReviewSummary = {
    usersChecked: 0,
    reviewsFinalized: 0,
    sent: 0,
    drafted: 0,
  };

  const mailboxes = await mailboxRepository.listForBackfill(200);
  const seenUsers = new Set<string>();

  for (const mailbox of mailboxes) {
    if (seenUsers.has(mailbox.userId)) continue;
    seenUsers.add(mailbox.userId);
    summary.usersChecked += 1;

    try {
      const policy = await getAutopilotPolicyForMailbox(
        mailbox.userId,
        mailbox.id,
      );
      if (!policy.enabled || !policy.morningReview) continue;

      const overnight = await getOvernightSummary(
        mailbox.userId,
        now,
        policy,
      );
      const total =
        overnight.totals.sent +
        overnight.totals.drafted +
        overnight.totals.blocked;
      if (total === 0) continue;

      summary.sent += overnight.totals.sent;
      summary.drafted += overnight.totals.drafted;
      summary.reviewsFinalized += 1;

      await invalidateBriefing(mailbox.userId).catch(() => {});
      await assistantSettingsRepository
        .upsert({
          values: { userId: mailbox.userId },
          set: { overnightReviewLastAt: now, updatedAt: now },
        })
        .catch(() => {});
    } catch (error) {
      console.warn(
        `[autopilot-review] failed for mailbox ${mailbox.id}`,
        error,
      );
    }
  }

  return summary;
}
