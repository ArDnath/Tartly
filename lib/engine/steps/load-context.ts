import "server-only";

import { z } from "zod";

import { defineStep } from "@/lib/engine/step";
import { loadThreadContext } from "@/lib/email-operator/thread-context";
import { requireThreadId } from "./helpers";

/**
 * Loads the thread's history, sender contact and metadata into the run state so
 * the drafting/egress steps do not re-query. `critical`: without context the
 * downstream steps cannot act safely.
 */
export const loadContextStep = defineStep({
  type: "load-context",
  configSchema: z.object({
    historyLimit: z.number().int().positive().max(50).optional(),
  }),
  async run(ctx) {
    const threadId = requireThreadId(ctx);
    const context = await loadThreadContext({
      userId: ctx.userId,
      threadId,
      historyLimit: ctx.input.historyLimit ?? 6,
    });

    if (!context) {
      throw new Error(`Thread ${threadId} not found for user.`);
    }

    const history = context.history.map((message) => ({
      direction: message.direction,
      from: message.fromAddr,
      subject: message.subject,
      text: message.bodyText,
      sentAt: message.sentAt ? message.sentAt.toISOString() : null,
    }));

    const latestMessage = context.latestInbound
      ? {
          from: context.latestInbound.fromAddr,
          subject: context.latestInbound.subject,
          text: context.latestInbound.bodyText,
          sentAt: context.latestInbound.sentAt
            ? context.latestInbound.sentAt.toISOString()
            : null,
        }
      : null;

    const contact = context.contact
      ? {
          email: context.contact.email,
          name: context.contact.name,
          autonomyOverride: context.contact.autonomyOverride,
        }
      : null;

    const output = {
      history,
      latestMessage,
      contact,
      thread: {
        id: context.thread.id,
        mailboxId: context.thread.mailboxId,
        gmailThreadId: context.thread.gmailThreadId,
        subject: context.thread.subject,
        isUnread: context.thread.isUnread,
      },
    };

    ctx.log("load-context", { messages: history.length });
    return output;
  },
});
