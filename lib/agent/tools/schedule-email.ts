import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import {
  MAX_SEND_BODY_CHARS,
  MAX_SEND_RECIPIENTS,
  MAX_SEND_SUBJECT_CHARS,
} from "@/lib/services/send-service";
import { ScheduleService, scheduleService } from "@/lib/services/schedule-service";

import { recipientSchema, requireSendPermission } from "./shared";

/**
 * `schedule_email` — EXTERNAL_SIDE_EFFECT.
 *
 * A future send. It is gated exactly like an immediate send: the model can only
 * propose it, the user's confirmation runs this tool once, and the tool records
 * a `scheduled_actions` row plus a `job_queue` trigger. At fire time the send
 * runs through the same idempotent path, keyed by the action, so a double-fire
 * cannot deliver twice.
 */

const inputSchema = z.object({
  to: z
    .array(recipientSchema)
    .min(1)
    .max(MAX_SEND_RECIPIENTS)
    .describe("Recipient email addresses."),
  cc: z
    .array(recipientSchema)
    .max(MAX_SEND_RECIPIENTS)
    .optional()
    .describe("Optional Cc recipients."),
  bcc: z
    .array(recipientSchema)
    .max(MAX_SEND_RECIPIENTS)
    .optional()
    .describe("Optional Bcc recipients."),
  subject: z
    .string()
    .max(MAX_SEND_SUBJECT_CHARS)
    .optional()
    .describe("Subject line."),
  body: z
    .string()
    .min(1)
    .max(MAX_SEND_BODY_CHARS)
    .describe("The plain-text body of the email."),
  sendAt: z
    .iso.datetime({ offset: true })
    .describe(
      "When to send, as an ISO 8601 timestamp with timezone (e.g. 2026-09-26T09:00:00Z).",
    ),
});

export type ScheduleEmailInput = z.infer<typeof inputSchema>;

function buildScheduleEmailTool(
  scheduler: ScheduleService,
): AnyToolDefinition {
  return defineTool({
    name: "schedule_email",
    description:
      "Prepare an email to be sent later. Calling this does NOT schedule or send anything: it creates a confirmation card the user must approve, and only then is it queued for the chosen time. Use sendAt with a full ISO 8601 timestamp.",
    risk: "EXTERNAL_SIDE_EFFECT",
    inputSchema,
    authorize(ctx) {
      requireSendPermission(ctx);
    },
    async execute(ctx, input) {
      if (!ctx.pendingActionId) {
        throw new Error(
          "schedule_email can only run from a confirmed action.",
        );
      }
      const result = await scheduler.scheduleEmail({
        userId: ctx.userId,
        pendingActionId: ctx.pendingActionId,
        runAfter: new Date(input.sendAt),
        to: input.to,
        ...(input.cc?.length ? { cc: input.cc } : {}),
        ...(input.bcc?.length ? { bcc: input.bcc } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        body: input.body,
      });

      return {
        scheduled: true,
        existing: result.existing,
        scheduledActionId: result.scheduledActionId,
        runAfter: result.runAfter,
        to: input.to,
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        notice: result.existing
          ? "This send was already scheduled; it was not scheduled again."
          : "Scheduled. It will be sent at the chosen time.",
      };
    },
  });
}

/** `schedule_email` — EXTERNAL_SIDE_EFFECT. Injectable for tests. */
export function createScheduleEmailTool(
  deps: { scheduler?: ScheduleService } = {},
): AnyToolDefinition {
  return buildScheduleEmailTool(deps.scheduler ?? scheduleService);
}

export const scheduleEmailTool = buildScheduleEmailTool(scheduleService);
