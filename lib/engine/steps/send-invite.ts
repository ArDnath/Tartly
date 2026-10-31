import "server-only";

import { z } from "zod";

import { defineStep } from "@/lib/engine/step";
import { sendFromMirroredMailbox } from "@/lib/mail/send";
import { meetingRepository } from "@/lib/repositories/meetings";
import { threadRepository } from "@/lib/repositories/threads";
import { mailboxRepository } from "@/lib/repositories/mailboxes";
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

    const meeting = await meetingRepository.findById(meetingId);
    if (!meeting) throw new Error(`Meeting ${meetingId} not found.`);

    const thread = await threadRepository.findById(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found.`);

    const mailbox = await mailboxRepository.findById(thread.mailboxId);
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

    const result = await sendFromMirroredMailbox({
      userId: ctx.userId,
      provider: mailbox.provider,
      from: mailbox.email,
      threadId: thread.gmailThreadId,
      email: {
        from: mailbox.email,
        to: [latest.from],
        subject: thread.subject ? `Re: ${thread.subject}` : "Meeting confirmed",
        text: lines.join("\n"),
      },
      idempotencyKey: `invite:${meeting.id}`,
    });

    ctx.log("send-invite", { deduped: result.deduped });
    return { sent: true, deduped: result.deduped };
  },
});
