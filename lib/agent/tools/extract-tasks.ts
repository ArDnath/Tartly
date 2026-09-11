import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { ValidationError } from "@/lib/agent/errors";
import { EmailService, emailService } from "@/lib/services/email-service";
import { TaskService, taskService } from "@/lib/services/task-service";

import { requireReadPermission } from "./shared";

/**
 * `extract_tasks` — READ.
 *
 * Reads a message or thread and returns the action items in it. The extraction
 * is a deterministic heuristic first (works with no AI key); a model refines it
 * only when one is configured and the caller opts in.
 */

const MAX_EXTRACT_CHARS = 20_000;

const inputSchema = z
  .object({
    messageId: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe("A single message id from search_emails or get_email."),
    threadId: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe("A thread id from search_emails or get_thread."),
    useModel: z
      .boolean()
      .optional()
      .describe(
        "Ask the configured model to refine the list. Falls back to the heuristic when no model is available.",
      ),
  })
  .refine((value) => Boolean(value.messageId || value.threadId), {
    message: "Provide a messageId or a threadId.",
  });

export type ExtractTasksInput = z.infer<typeof inputSchema>;

function buildExtractTasksTool(
  email: EmailService,
  tasks: TaskService,
): AnyToolDefinition {
  return defineTool({
    name: "extract_tasks",
    description:
      "Extract action items from a message or thread. Use it when the user asks what they need to do, or to turn a conversation into a to-do list.",
    risk: "READ",
    inputSchema,
    authorize(ctx) {
      requireReadPermission(ctx);
    },
    async execute(ctx, input) {
      let source: string;
      let text: string;

      if (input.messageId) {
        const message = await email.getMessage({
          userId: ctx.userId,
          messageId: input.messageId,
        });
        source = `message:${message.id}`;
        text = `Subject: ${message.subject}\n\n${message.bodyText}`;
      } else if (input.threadId) {
        const thread = await email.getThread({
          userId: ctx.userId,
          threadId: input.threadId,
        });
        source = `thread:${thread.id}`;
        text = thread.messages
          .map(
            (message) =>
              `From: ${message.from.email}\nSubject: ${message.subject}\n\n${message.bodyText}`,
          )
          .join("\n\n---\n\n");
      } else {
        throw new ValidationError("Provide a messageId or a threadId.");
      }

      const result = await tasks.extract({
        userId: ctx.userId,
        text: text.slice(0, MAX_EXTRACT_CHARS),
        ...(input.useModel !== undefined ? { useModel: input.useModel } : {}),
      });

      return {
        source,
        method: result.method,
        count: result.tasks.length,
        tasks: result.tasks,
        contentTrust: "untrusted-external-content",
        notice:
          result.tasks.length === 0
            ? "No action items were found in that content."
            : "These are suggestions derived from the message text; they are not stored.",
      };
    },
  });
}

/** `extract_tasks` — READ. Injectable for tests. */
export function createExtractTasksTool(
  deps: { email?: EmailService; tasks?: TaskService } = {},
): AnyToolDefinition {
  return buildExtractTasksTool(
    deps.email ?? emailService,
    deps.tasks ?? taskService,
  );
}

export const extractTasksTool = buildExtractTasksTool(emailService, taskService);
