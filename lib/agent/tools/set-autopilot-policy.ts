import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import {
  AUTOPILOT_CATEGORIES,
  setAutopilotPolicy,
  type AutopilotPolicyPatch,
} from "@/lib/settings/autopilot";

import { requireWritePermission } from "./shared";

const inputSchema = z.object({
  enabled: z
    .boolean()
    .optional()
    .describe("Turn 24/7 Autopilot on or off for the connected mailbox."),
  mode: z
    .enum(["window", "always"])
    .optional()
    .describe("'window' sends only inside the hours; 'always' sends any time."),
  timezone: z.string().min(1).max(100).optional(),
  days: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  windowStartHour: z.number().int().min(0).max(23).optional(),
  windowEndHour: z.number().int().min(0).max(23).optional(),
  minConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  requireKnownSender: z.boolean().optional(),
  allowedCategories: z.array(z.enum(AUTOPILOT_CATEGORIES)).max(7).optional(),
  maxPerHour: z.number().int().min(1).optional(),
  maxPerDay: z.number().int().min(1).optional(),
  maxPerThread: z.number().int().min(1).optional(),
  loopThreshold: z.number().int().min(1).optional(),
  morningReview: z.boolean().optional(),
});

export type SetAutopilotPolicyInput = z.infer<typeof inputSchema>;

function buildSetAutopilotPolicyTool(): AnyToolDefinition {
  return defineTool({
    name: "set_autopilot_policy",
    description:
      "Update the 24/7 Autopilot policy for the mailbox: enable/disable it, set the send window (mode, timezone, days, hours), confidence floor, known-sender requirement, category allowlist and send caps. Values are clamped to platform ceilings. This never sends anything by itself; it only configures what the background operator may do.",
    risk: "WRITE",
    inputSchema,
    authorize(ctx) {
      requireWritePermission(ctx);
    },
    async execute(ctx, input) {
      const patch: AutopilotPolicyPatch = {};
      for (const key of Object.keys(input) as Array<keyof SetAutopilotPolicyInput>) {
        if (input[key] !== undefined) {
          (patch as Record<string, unknown>)[key] = input[key];
        }
      }

      const policy = await setAutopilotPolicy(ctx.userId, patch);

      return {
        policy,
        notice: policy.enabled
          ? `24/7 Autopilot is on (${policy.mode === "always" ? "any time" : `${policy.windowStartHour}:00–${policy.windowEndHour}:00 ${policy.timezone}`}). Anything risky becomes a draft.`
          : "24/7 Autopilot is off. Replies stay as drafts.",
      };
    },
  });
}

/** `set_autopilot_policy` — WRITE (reversible config). */
export const setAutopilotPolicyTool = buildSetAutopilotPolicyTool();

export type SetAutopilotPolicyOutput = Awaited<
  ReturnType<typeof setAutopilotPolicyTool.execute>
>;
