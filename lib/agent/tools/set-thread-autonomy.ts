import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { AuthorizationError } from "@/lib/agent/errors";
import { setThreadAutonomy } from "@/lib/settings/autonomy";

import { requireWritePermission } from "./shared";

const inputSchema = z.object({
  threadId: z
    .string()
    .min(1)
    .max(256)
    .describe("The thread to change, from search_emails or get_thread."),
  autonomy: z
    .enum(["copilot", "autopilot"])
    .nullable()
    .describe(
      " 'autopilot' lets the background operator send on this thread; 'copilot' always drafts for approval; null clears the override back to inherit.",
    ),
});

export type SetThreadAutonomyInput = z.infer<typeof inputSchema>;

function buildSetThreadAutonomyTool(): AnyToolDefinition {
  return defineTool({
    name: "set_thread_autonomy",
    description:
      "Set or clear the per-thread autonomy override. Use when the user says 'autopilot this thread' or 'keep this one in copilot'. Reversible and mailbox-scoped; it never sends anything by itself.",
    risk: "WRITE",
    inputSchema,
    authorize(ctx) {
      requireWritePermission(ctx);
    },
    async execute(ctx, input) {
      const updated = await setThreadAutonomy(
        ctx.userId,
        input.threadId,
        input.autonomy,
      );
      if (!updated) {
        throw new AuthorizationError("That thread does not belong to this account.");
      }
      return {
        threadId: input.threadId,
        autonomy: input.autonomy,
        notice:
          input.autonomy === null
            ? "Thread override cleared; it now inherits from the contact and mailbox."
            : `This thread is now ${input.autonomy}. Guardrails still force a draft when they trigger.`,
      };
    },
  });
}

/** `set_thread_autonomy` — WRITE (reversible). */
export const setThreadAutonomyTool = buildSetThreadAutonomyTool();

export type SetThreadAutonomyOutput = Awaited<
  ReturnType<typeof setThreadAutonomyTool.execute>
>;
