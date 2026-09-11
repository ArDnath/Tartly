import { z } from "zod";

import { AuthorizationError } from "@/lib/agent/errors";
import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { EmailService, emailService } from "@/lib/services/email-service";

import { formatAddress, SEARCH_SNIPPET_CHARS, truncate } from "./shared";

const inputSchema = z.object({
  query: z
    .string()
    .max(512)
    .optional()
    .describe(
      "Gmail search query (same syntax as Gmail search, e.g. 'from:jane@acme.com newer_than:7d', 'subject:pricing', 'has:attachment'). Omit to list the mailbox view.",
    ),
  box: z
    .enum(["inbox", "sent", "archive", "drafts", "trash", "spam", "all"])
    .optional()
    .describe("Which mailbox view to search. Defaults to inbox."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("Maximum number of messages to return. Defaults to 10."),
});

export type SearchEmailsInput = z.infer<typeof inputSchema>;

function buildSearchEmailsTool(email: EmailService): AnyToolDefinition {
  return defineTool({
    name: "search_emails",
    description:
      "Search the user's mailbox and return compact message rows (sender, subject, snippet, date). Use Gmail query syntax. This returns metadata only — call get_email or get_thread for bodies.",
    risk: "READ",
    inputSchema,
    authorize(ctx) {
      if (!ctx.permissions.canRead) {
        throw new AuthorizationError("Reading mail is not permitted for this account.");
      }
    },
    async execute(ctx, input) {
      const result = await email.searchMessages({
        userId: ctx.userId,
        ...(input.query ? { query: input.query } : {}),
        ...(input.box ? { box: input.box } : {}),
        ...(input.limit ? { limit: input.limit } : {}),
      });

      return {
        count: result.messages.length,
        hasMore: Boolean(result.nextPageToken),
        messages: result.messages.map((message) => ({
          id: message.id,
          threadId: message.threadId,
          from: formatAddress(message.from),
          subject: message.subject,
          snippet: truncate(message.snippet, SEARCH_SNIPPET_CHARS).text,
          date: message.receivedAt,
          direction: message.direction,
          unread: message.unread,
          hasAttachments: message.hasAttachments,
        })),
      };
    },
  });
}

/** `search_emails` — READ. Injectable for tests. */
export function createSearchEmailsTool(
  deps: { email?: EmailService } = {},
): AnyToolDefinition {
  return buildSearchEmailsTool(deps.email ?? emailService);
}

/**
 * `search_emails` — READ.
 *
 * Returns compact rows only. The model is expected to follow up with
 * `get_email` / `get_thread` when it needs a body, which keeps each model call
 * small and keeps us from ever shipping a mailbox to the provider.
 */
export const searchEmailsTool = buildSearchEmailsTool(emailService);

export type SearchEmailsOutput = Awaited<ReturnType<typeof searchEmailsTool.execute>>;
