import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import {
  MAX_SEND_BODY_CHARS,
  MAX_SEND_RECIPIENTS,
  MAX_SEND_SUBJECT_CHARS,
  SendService,
  sendService,
} from "@/lib/services/send-service";

import { recipientSchema, requireSendPermission } from "./shared";

/**
 * `send_email` — EXTERNAL_SIDE_EFFECT.
 *
 * The model can *propose* a send, but the loop's permission engine turns that
 * into a persisted pending action instead of calling `execute`. `execute` only
 * runs through `createRegistryActionExecutor` after a server-verified
 * confirmation, which is also the only caller that injects `ctx.idempotencyKey`.
 * Without that key the send service refuses.
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
  account: z
    .enum(["gmail", "outlook"])
    .optional()
    .describe(
      "Which connected account to send from. Omit to use the default mailbox (Gmail when connected).",
    ),
  assetIds: z
    .array(z.string())
    .max(20)
    .optional()
    .describe(
      "Optional ids from list_assets to attach as files. Only ids returned by list_assets.",
    ),
  inlineImageIds: z
    .array(z.string())
    .max(20)
    .optional()
    .describe(
      "Optional image ids from list_assets to render inline in the message body.",
    ),
});

export type SendEmailInput = z.infer<typeof inputSchema>;

function buildSendEmailTool(sender: SendService): AnyToolDefinition {
  return defineTool({
    name: "send_email",
    description:
      "Prepare an email to send from Gmail or Outlook. Calling this does NOT send anything: it creates a confirmation card the user must approve. Use it for a new message (pass account when the user names a mailbox). Only use recipient addresses that came from a tool result or from the user; never invent one.",
    risk: "EXTERNAL_SIDE_EFFECT",
    inputSchema,
    authorize(ctx) {
      requireSendPermission(ctx);
    },
    async execute(ctx, input) {
      const result = await sender.sendMessage({
        userId: ctx.userId,
        ...(ctx.idempotencyKey ? { idempotencyKey: ctx.idempotencyKey } : {}),
        to: input.to,
        ...(input.cc?.length ? { cc: input.cc } : {}),
        ...(input.bcc?.length ? { bcc: input.bcc } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        body: input.body,
        ...(input.account ? { account: input.account } : {}),
        ...(input.assetIds?.length ? { assetIds: input.assetIds } : {}),
        ...(input.inlineImageIds?.length
          ? { inlineImageIds: input.inlineImageIds }
          : {}),
      });

      return {
        sent: !result.deduped,
        deduped: result.deduped,
        provider: result.provider,
        to: result.to,
        subject: result.subject,
        gmailMessageId: result.gmailMessageId,
        notice: result.deduped
          ? "This message was already sent; it was not sent again."
          : "Email sent.",
      };
    },
  });
}

/** `send_email` — EXTERNAL_SIDE_EFFECT. Injectable for tests. */
export function createSendEmailTool(
  deps: { sender?: SendService } = {},
): AnyToolDefinition {
  return buildSendEmailTool(deps.sender ?? sendService);
}

export const sendEmailTool = buildSendEmailTool(sendService);
