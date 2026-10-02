import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { threads } from "@/lib/db/schema";
import { defineStep } from "@/lib/engine/step";
import { resolveAutonomy } from "@/lib/settings/autonomy";
import { requireThreadId } from "./helpers";

/**
 * The single send gate. Nothing else may call `gmail.send`.
 *
 * Sending requires `autopilot` on the most specific scope (thread → contact →
 * mailbox) and no guardrail violation. Every other combination drafts for the
 * user to approve. A per-thread override wins in both directions.
 */
export const egressStep = defineStep({
  type: "egress",
  configSchema: z.object({}),
  async run(ctx) {
    const threadId = requireThreadId(ctx);

    const threadRows = await db
      .select({ mailboxId: threads.mailboxId })
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);

    const mailboxId = threadRows[0]?.mailboxId ?? null;
    const contactEmail = (
      ctx.state.contact as { email?: string | null } | undefined
    )?.email;

    const { autonomy, source } = await resolveAutonomy({
      userId: ctx.userId,
      threadId,
      contactEmail: contactEmail ?? null,
      mailboxId,
    });

    const forcedDraft = ctx.state.forcedDraft === true;

    let decision: "draft" | "send";
    let reason: string;

    if (autonomy !== "autopilot") {
      decision = "draft";
      reason = source === "mailbox" ? "mailbox_copilot" : `${source}_copilot`;
    } else if (forcedDraft) {
      decision = "draft";
      reason = "guardrails_forced_draft";
    } else {
      decision = "send";
      reason = source === "mailbox" ? "autopilot" : `${source}_autopilot`;
    }

    ctx.log("egress", { decision, reason, autonomy, source });
    return { decision, reason, autonomy, autonomySource: source };
  },
});
