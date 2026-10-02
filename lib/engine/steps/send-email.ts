import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { db } from "@/lib/db";
import { drafts, mailboxes, messages, threads } from "@/lib/db/schema";
import { defineStep } from "@/lib/engine/step";
import { sendEmail } from "@/lib/gmail/send";
import { requireThreadId } from "./helpers";

/**
 * The only step that calls `gmail.send`. Guarded by `sendLedger` idempotency so
 * a retried drain cannot double-send. Only reached when `egress` decided
 * `send`; the guard is repeated here defensively.
 */
export const sendEmailStep = defineStep({
  type: "send-email",
  configSchema: z.object({ idempotencyKey: z.string().max(200).optional() }),
  async run(ctx) {
    const threadId = requireThreadId(ctx);

    if (ctx.state.decision !== "send") {
      ctx.log("send-email", { skipped: true });
      return { sent: false, skipped: true, gmailMessageId: null };
    }

    const threadRows = await db
      .select()
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);
    const thread = threadRows[0];
    if (!thread) throw new Error(`Thread ${threadId} not found.`);

    const mailboxRows = await db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.id, thread.mailboxId))
      .limit(1);
    const mailbox = mailboxRows[0];
    if (!mailbox) throw new Error(`Mailbox ${thread.mailboxId} not found.`);

    const latest = ctx.state.latestMessage as
      | { from?: string | null }
      | undefined;
    const recipient = latest?.from;
    const body = typeof ctx.state.body === "string" ? ctx.state.body : "";
    if (!recipient || !body) {
      throw new Error("send-email is missing a recipient or body.");
    }

    const result = await sendEmail({
      userId: ctx.userId,
      email: {
        from: mailbox.email,
        to: [recipient],
        subject: thread.subject ? `Re: ${thread.subject}` : "Re:",
        text: body,
      },
      gmailThreadId: thread.gmailThreadId,
      idempotencyKey:
        ctx.input.idempotencyKey ?? `run:${ctx.runId}:thread:${threadId}`,
    });

    // Mirror the sent message so the thread view reflects it immediately.
    if (result.gmailMessageId) {
      await db
        .insert(messages)
        .values({
          id: nanoid(),
          threadId,
          gmailMessageId: result.gmailMessageId,
          direction: "outbound",
          fromAddr: mailbox.email,
          toAddr: [recipient],
          subject: thread.subject ? `Re: ${thread.subject}` : "Re:",
          bodyText: body,
          sentAt: new Date(),
        })
        .onConflictDoNothing({ target: messages.gmailMessageId });
    }

    const draftId = typeof ctx.state.draftId === "string" ? ctx.state.draftId : null;
    if (draftId) {
      await db
        .update(drafts)
        .set({ status: "sent", sentBy: "ai", decidedAt: new Date() })
        .where(eq(drafts.id, draftId));
    }

    ctx.log("send-email", { deduped: result.deduped, id: result.gmailMessageId });
    return {
      sent: true,
      deduped: result.deduped,
      gmailMessageId: result.gmailMessageId,
    };
  },
});
