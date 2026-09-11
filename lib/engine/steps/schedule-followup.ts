import "server-only";

import { z } from "zod";

import { defineStep } from "@/lib/engine/step";
import { enrollThread } from "@/lib/followup/service";
import { requireThreadId } from "./helpers";

/**
 * After we reply, enroll the thread in a follow-up cadence. Best-effort: a
 * failure here must not fail the run (the reply already exists).
 */
export const scheduleFollowupStep = defineStep({
  type: "schedule-followup",
  policy: "best_effort",
  configSchema: z.object({
    afterDays: z.number().int().min(1).max(30).default(3),
    maxAttempts: z.number().int().min(1).max(10).default(3),
  }),
  async run(ctx) {
    const threadId = requireThreadId(ctx);
    const replied = Boolean(ctx.state.draftId) || ctx.state.sent === true;

    if (!replied) {
      ctx.log("schedule-followup", { skipped: true });
      return { enrollmentId: null };
    }

    const enrollment = await enrollThread({
      userId: ctx.userId,
      threadId,
      afterDays: ctx.input.afterDays,
      maxAttempts: ctx.input.maxAttempts,
    });

    ctx.log("schedule-followup", { enrollmentId: enrollment?.id ?? null });
    return { enrollmentId: enrollment?.id ?? null };
  },
});
