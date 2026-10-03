import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import {
  extractEmail,
  MAX_DRAFT_BODY_CHARS,
  MAX_DRAFT_RECIPIENTS,
  MAX_DRAFT_SUBJECT_CHARS,
} from "@/lib/services/draft-service";

import { recipientSchema, requireReadPermission } from "./shared";

/**
 * `deliver_composer_draft` — the composer agent's terminal action.
 *
 * Unlike `create_draft`, this never touches the mailbox: it returns the
 * finished fields as its tool result, which the composer reads off the streamed
 * UI message (a `deliver_composer_draft` tool part) and drops into the form for
 * the user to review and send. It is `READ` risk because it has no side effect.
 * It is not part of the default agent registry, so the assistant chat cannot
 * call it.
 */

export const DELIVER_COMPOSER_DRAFT_TOOL_NAME = "deliver_composer_draft";

const inputSchema = z.object({
  to: z
    .array(recipientSchema)
    .max(MAX_DRAFT_RECIPIENTS)
    .optional()
    .describe(
      "Recipient addresses found in the mailbox (search_contacts / search_emails) or given by the user. Leave empty only when no address could be found.",
    ),
  cc: z
    .array(recipientSchema)
    .max(MAX_DRAFT_RECIPIENTS)
    .optional()
    .describe("Cc recipients. Only when the user explicitly asks to copy someone."),
  bcc: z
    .array(recipientSchema)
    .max(MAX_DRAFT_RECIPIENTS)
    .optional()
    .describe(
      "Bcc recipients. Only when the user explicitly asks to blind-copy someone.",
    ),
  subject: z
    .string()
    .max(MAX_DRAFT_SUBJECT_CHARS)
    .optional()
    .describe("Subject line. Omit only when the user asked for no subject."),
  body: z
    .string()
    .min(1)
    .max(MAX_DRAFT_BODY_CHARS)
    .describe("The finished plain-text body."),
});

export type DeliverComposerDraftInput = z.infer<typeof inputSchema>;

/** The fields the composer applies once the agent finishes. */
export interface ComposerDraft {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
}

/** Normalise `Name <address>` to the bare address the composer chips expect. */
function normalizeAddresses(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => extractEmail(value) ?? value))];
}

export function createDeliverComposerDraftTool(): AnyToolDefinition {
  return defineTool({
    name: DELIVER_COMPOSER_DRAFT_TOOL_NAME,
    description:
      "Hand the finished email to the composer the user is editing. Call this exactly once, once the recipient(s), subject and body are ready. This does NOT send — the user reviews and approves. Never pass an address you did not get from a tool result or the user.",
    risk: "READ",
    inputSchema,
    authorize(ctx) {
      requireReadPermission(ctx);
    },
    async execute(_ctx, input) {
      const draft: ComposerDraft = {
        to: normalizeAddresses(input.to),
        cc: normalizeAddresses(input.cc),
        bcc: normalizeAddresses(input.bcc),
        subject: input.subject?.trim() ?? "",
        body: input.body.trim(),
      };
      return draft;
    },
  });
}

/** The single instance the compose registry registers. */
export const deliverComposerDraftTool = createDeliverComposerDraftTool();
