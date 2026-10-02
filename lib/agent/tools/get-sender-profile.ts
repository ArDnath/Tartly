import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import {
  findSenderUnsubscribeInfo,
  selectUnsubscribeMechanism,
} from "@/lib/ai/features/unsubscribe";
import { getSenderProfile } from "@/lib/ai/features/sender-profiles";
import { loadThreadContext } from "@/lib/email-operator/thread-context";

import { requireReadPermission, UNTRUSTED_CONTENT_NOTICE } from "./shared";

/**
 * `get_sender_profile` — READ.
 *
 * What we know about a sender: category, cold-email score, and whether they
 * offer an unsubscribe mechanism. Deterministic and free (read from the cached
 * profile), so the agent can explain "why is this in my inbox?" without a model
 * call.
 */

const inputSchema = z
  .object({
    email: z
      .string()
      .min(3)
      .max(320)
      .optional()
      .describe("The sender address, e.g. from search_emails results."),
    threadId: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe("A thread id; the latest inbound sender is looked up."),
  })
  .refine((value) => Boolean(value.email || value.threadId), {
    message: "Provide an email or a threadId.",
  });

export type GetSenderProfileInput = z.infer<typeof inputSchema>;

export const getSenderProfileTool: AnyToolDefinition = defineTool({
  name: "get_sender_profile",
  description:
    "Look up what we know about an email sender: their category (Personal, Newsletters, Cold Outreach, …), cold-email score, and whether they support unsubscribe. Use it to explain why mail was filed a certain way or before suggesting an unsubscribe.",
  risk: "READ",
  inputSchema,
  authorize(ctx) {
    requireReadPermission(ctx);
  },
  async execute(ctx, input) {
    let email = input.email?.trim().toLowerCase() ?? "";
    if (!email && input.threadId) {
      const context = await loadThreadContext({
        userId: ctx.userId,
        threadId: input.threadId,
        historyLimit: 3,
      });
      email = context?.latestInbound?.fromAddr?.toLowerCase() ?? "";
    }
    if (!email) return { found: false, notice: "No sender address found." };

    const [profile, unsubscribe] = await Promise.all([
      getSenderProfile({ userId: ctx.userId, email }),
      findSenderUnsubscribeInfo({ userId: ctx.userId, senderEmail: email }),
    ]);

    const mechanism = selectUnsubscribeMechanism(unsubscribe?.info);
    return {
      found: Boolean(profile),
      email,
      category: profile?.category ?? "Other",
      coldEmailScore: profile?.coldEmailScore ?? 0,
      isColdEmail: (profile?.coldEmailScore ?? 0) >= 70,
      status: profile?.status ?? "unknown",
      unsubscribe: {
        method: mechanism.method,
        available: mechanism.method !== "none",
      },
      contentTrust: "untrusted-external-content",
      contentNotice: UNTRUSTED_CONTENT_NOTICE,
    };
  },
});
