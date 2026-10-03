import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { pauseAutopilot } from "@/lib/settings/autopilot";

import { requireWritePermission } from "./shared";

const inputSchema = z.object({
  alsoSetCopilot: z
    .boolean()
    .optional()
    .describe(
      "Also set the mailbox back to copilot, so nothing can auto-send until the user re-enables it. Default false.",
    ),
});

export type PauseAutopilotInput = z.infer<typeof inputSchema>;

function buildPauseAutopilotTool(): AnyToolDefinition {
  return defineTool({
    name: "pause_autopilot",
    description:
      "Immediately pause all automatic sending for the user's mailbox (the kill switch). Idempotent. Use whenever the user says stop sending, pause autopilot, or when they are worried about a reply.",
    risk: "WRITE",
    inputSchema,
    authorize(ctx) {
      requireWritePermission(ctx);
    },
    async execute(ctx, input) {
      const policy = await pauseAutopilot(ctx.userId, {
        alsoSetCopilot: input.alsoSetCopilot === true,
      });
      return {
        paused: true,
        enabled: policy.enabled,
        notice: input.alsoSetCopilot
          ? "Autopilot is paused and the mailbox is back to copilot: every reply will be a draft."
          : "Autopilot is paused. Replies stay as drafts until you re-enable it.",
      };
    },
  });
}

/** `pause_autopilot` — WRITE (kill switch). */
export const pauseAutopilotTool = buildPauseAutopilotTool();

export type PauseAutopilotOutput = Awaited<
  ReturnType<typeof pauseAutopilotTool.execute>
>;
