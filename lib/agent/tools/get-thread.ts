import { z } from "zod";

import { AuthorizationError } from "@/lib/agent/errors";
import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { EmailService, emailService } from "@/lib/services/email-service";

import {
  formatAddress,
  MAX_THREAD_MESSAGES,
  THREAD_MESSAGE_BODY_CHARS,
  truncate,
  UNTRUSTED_CONTENT_NOTICE,
} from "./shared";

const inputSchema = z.object({
  threadId: z
    .string()
    .min(1)
    .max(256)
    .describe("The thread id returned by search_emails."),
  maxMessages: z
    .number()
    .int()
    .min(1)
    .max(MAX_THREAD_MESSAGES)
    .optional()
    .describe("Maximum messages to include, oldest first. Defaults to 20."),
});

export type GetThreadInput = z.infer<typeof inputSchema>;

function buildGetThreadTool(email: EmailService): AnyToolDefinition {
  return defineTool({
    name: "get_thread",
    description:
      "Read a full email conversation (all messages, oldest first) by thread id. Use to summarize a thread or understand prior context before drafting.",
    risk: "READ",
    inputSchema,
    authorize(ctx) {
      if (!ctx.permissions.canRead) {
        throw new AuthorizationError("Reading mail is not permitted for this account.");
      }
    },
    async execute(ctx, input) {
      const thread = await email.getThread({
        userId: ctx.userId,
        threadId: input.threadId,
      });

      const limit = input.maxMessages ?? MAX_THREAD_MESSAGES;
      const truncatedThread = thread.messages.length > limit;
      const selected = truncatedThread
        ? thread.messages.slice(thread.messages.length - limit)
        : thread.messages;

      return {
        threadId: thread.id,
        subject: thread.subject,
        totalMessages: thread.messages.length,
        returnedMessages: selected.length,
        olderMessagesOmitted: thread.messages.length - selected.length,
        messages: selected.map((message) => {
          const body = truncate(message.bodyText, THREAD_MESSAGE_BODY_CHARS);
          return {
            id: message.id,
            from: formatAddress(message.from),
            date: message.receivedAt,
            direction: message.direction,
            body: body.text,
            bodyTruncated: body.truncated,
          };
        }),
        contentTrust: "untrusted-external-content",
        contentNotice: UNTRUSTED_CONTENT_NOTICE,
      };
    },
  });
}

/** `get_thread` — READ. Injectable for tests. */
export function createGetThreadTool(
  deps: { email?: EmailService } = {},
): AnyToolDefinition {
  return buildGetThreadTool(deps.email ?? emailService);
}

/**
 * `get_thread` — READ.
 *
 * Returns a conversation, oldest first, with each body truncated. The most
 * recent messages carry the most signal, so when a thread exceeds the limit we
 * keep the *latest* messages rather than the first.
 */
export const getThreadTool = buildGetThreadTool(emailService);

export type GetThreadOutput = Awaited<ReturnType<typeof getThreadTool.execute>>;
