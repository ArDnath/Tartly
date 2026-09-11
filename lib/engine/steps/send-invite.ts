import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { mailboxes, meetings, threads } from "@/lib/db/schema";
import { defineStep } from "@/lib/engine/step";
import { sendEmail } from "@/lib/gmail/send";
import { requireThreadId } from "./helpers";

/** Emails the confirmed meeting details (time + Meet link). Idempotent. */
export const sendInviteStep = defineStep({
  type: "send-invite",
  configSchema: z.object({}),
  async run(ctx) {
    const threadId = requireThreadId(ctx);
    const meetingId =
      typeof ctx.state.meetingId === "string" ? ctx.state.meetingId : null;
    if (!meetingId) {
      ctx.log("send-invite", { skipped: true });
      return { sent: false, skipped: true };
    }

    const meetingRows = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, meetingId))
      .limit(1);
    const meeting = meetingRows[0];
    if (!meeting) throw new Error(`Meeting ${meetingId} not found.`);

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

    const latest = ctx.state.latestMessage as { from?: string | null } | undefined;
    if (!latest?.from) throw new Error("send-invite requires a recipient.");

    const when = meeting.startAt
      ? meeting.startAt.toISOString()
      : "the proposed time";
    const lines = [
      "Confirmed — the meeting is booked.",
      "",
      `When: ${when}${meeting.endAt ? ` → ${meeting.endAt.toISOString()}` : ""}`,
    ];
    if (meeting.meetLink) lines.push(`Meet: ${meeting.meetLink}`);

    const result = await sendEmail({
      userId: ctx.userId,
      email: {
        from: mailbox.email,
        to: [latest.from],
        subject: thread.subject ? `Re: ${thread.subject}` : "Meeting confirmed",
        text: lines.join("\n"),
      },
      gmailThreadId: thread.gmailThreadId,
      idempotencyKey: `invite:${meeting.id}`,
    });

    ctx.log("send-invite", { deduped: result.deduped });
    return { sent: true, deduped: result.deduped };
  },
});
