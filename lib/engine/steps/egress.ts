import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { mailboxes, threads } from "@/lib/db/schema";
import { defineStep } from "@/lib/engine/step";
import { requireThreadId } from "./helpers";

/**
 * The single send gate. Nothing else may call `gmail.send`.
 *
 * Sending requires `autopilot` on the mailbox, no per-contact `copilot`
 * override, and no guardrail violation. Every other combination drafts for the
 * user to approve.
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

    const mailboxId = threadRows[0]?.mailboxId;
    const mailbox = mailboxId
      ? (
          await db
            .select({ autonomy: mailboxes.autonomy })
            .from(mailboxes)
            .where(eq(mailboxes.id, mailboxId))
            .limit(1)
        )[0]
      : undefined;

    const contactOverride = (
      ctx.state.contact as { autonomyOverride?: string | null } | undefined
    )?.autonomyOverride;

    const mailboxAutonomy = mailbox?.autonomy ?? "copilot";
    const forcedDraft = ctx.state.forcedDraft === true;

    let decision: "draft" | "send";
    let reason: string;

    if (contactOverride === "copilot") {
      decision = "draft";
      reason = "contact_override_copilot";
    } else if (contactOverride === "autopilot") {
      decision = forcedDraft ? "draft" : "send";
      reason = forcedDraft ? "guardrails_forced_draft" : "contact_override_autopilot";
    } else if (mailboxAutonomy !== "autopilot") {
      decision = "draft";
      reason = "mailbox_copilot";
    } else if (forcedDraft) {
      decision = "draft";
      reason = "guardrails_forced_draft";
    } else {
      decision = "send";
      reason = "autopilot";
    }

    ctx.log("egress", { decision, reason });
    return { decision, reason };
  },
});
