import { z } from "zod";

import { AuthorizationError } from "@/lib/agent/errors";
import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { EmailService, emailService } from "@/lib/services/email-service";

import {
  formatAddress,
  formatAddresses,
  MESSAGE_BODY_CHARS,
  truncate,
  UNTRUSTED_CONTENT_NOTICE,
} from "./shared";

const inputSchema = z.object({
  messageId: z
    .string()
    .min(1)
    .max(256)
    .describe("The message id returned by search_emails or get_thread."),
});

export type GetEmailInput = z.infer<typeof inputSchema>;

function buildGetEmailTool(email: EmailService): AnyToolDefinition {
  return defineTool({
    name: "get_email",
    description:
      "Read one email by id, including its body (truncated). Use after search_emails when you need the actual content of a specific message.",
    risk: "READ",
    inputSchema,
    authorize(ctx) {
      if (!ctx.permissions.canRead) {
        throw new AuthorizationError("Reading mail is not permitted for this account.");
      }
    },
    async execute(ctx, input) {
      const message = await email.getMessage({
        userId: ctx.userId,
        messageId: input.messageId,
      });

      const body = truncate(message.bodyText, MESSAGE_BODY_CHARS);

      return {
        id: message.id,
        threadId: message.threadId,
        from: formatAddress(message.from),
        to: formatAddresses(message.to),
        cc: formatAddresses(message.cc),
        subject: message.subject,
        date: message.receivedAt,
        direction: message.direction,
        unread: message.unread,
        starred: message.starred,
        labels: message.labels,
        attachments: message.attachments.map((attachment) => ({
          name: attachment.name,
          size: attachment.size,
        })),
        body: body.text,
        bodyTruncated: body.truncated,
        contentTrust: "untrusted-external-content",
        contentNotice: UNTRUSTED_CONTENT_NOTICE,
      };
    },
  });
}

/** `get_email` — READ. Injectable for tests. */
export function createGetEmailTool(
  deps: { email?: EmailService } = {},
): AnyToolDefinition {
  return buildGetEmailTool(deps.email ?? emailService);
}

/**
 * `get_email` — READ.
 *
 * Returns one message with its body, truncated to a bounded size. The body is
 * explicitly labelled as untrusted third-party content.
 */
export const getEmailTool = buildGetEmailTool(emailService);

export type GetEmailOutput = Awaited<ReturnType<typeof getEmailTool.execute>>;
