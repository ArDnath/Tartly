import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import {
  DraftService,
  draftService,
  MAX_DRAFT_BODY_CHARS,
  MAX_DRAFT_RECIPIENTS,
  MAX_DRAFT_SUBJECT_CHARS,
} from "@/lib/services/draft-service";

import {
  DRAFT_BODY_PREVIEW_CHARS,
  recipientSchema,
  requireWritePermission,
  truncate,
} from "./shared";

const inputSchema = z.object({
  to: z
    .array(recipientSchema)
    .min(1)
    .max(MAX_DRAFT_RECIPIENTS)
    .describe("Recipient email addresses."),
  cc: z
    .array(recipientSchema)
    .max(MAX_DRAFT_RECIPIENTS)
    .optional()
    .describe("Optional Cc recipients."),
  bcc: z
    .array(recipientSchema)
    .max(MAX_DRAFT_RECIPIENTS)
    .optional()
    .describe("Optional Bcc recipients."),
  subject: z
    .string()
    .max(MAX_DRAFT_SUBJECT_CHARS)
    .optional()
    .describe("Subject line. Omit for a subject-less draft."),
  body: z
    .string()
    .min(1)
    .max(MAX_DRAFT_BODY_CHARS)
    .describe("The plain-text body of the draft."),
  account: z
    .enum(["gmail", "outlook"])
    .optional()
    .describe(
      "Which connected mailbox should hold a new draft. Omit to use the default (Gmail when connected); a reply is routed by threadId.",
    ),
  threadId: z
    .string()
    .max(256)
    .optional()
    .describe(
      "Set when the draft is a reply, so it lands in the existing conversation.",
    ),
  inReplyTo: z
    .string()
    .max(998)
    .optional()
    .describe("The Message-ID being replied to, for correct threading headers."),
});

export type CreateDraftInput = z.infer<typeof inputSchema>;

function buildCreateDraftTool(drafts: DraftService): AnyToolDefinition {
  return defineTool({
    name: "create_draft",
    description:
      "Save a new draft to the user's mailbox. It is NOT sent — drafting is reversible and safe. Use this to write an email or a reply for the user to review. Returns the draft id and a `version` to pass to update_draft later.",
    risk: "WRITE",
    inputSchema,
    authorize(ctx) {
      requireWritePermission(ctx);
    },
    async execute(ctx, input) {
      const draft = await drafts.createDraft({
        userId: ctx.userId,
        to: input.to,
        ...(input.cc?.length ? { cc: input.cc } : {}),
        ...(input.bcc?.length ? { bcc: input.bcc } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        body: input.body,
        ...(input.account ? { account: input.account } : {}),
        ...(input.threadId ? { threadId: input.threadId } : {}),
        ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
      });

      const preview = truncate(draft.body, DRAFT_BODY_PREVIEW_CHARS);
      return {
        draftId: draft.id,
        version: draft.version,
        updatedAt: draft.updatedAt,
        to: draft.to,
        ...(draft.cc.length ? { cc: draft.cc } : {}),
        ...(draft.bcc.length ? { bcc: draft.bcc } : {}),
        subject: draft.subject,
        ...(draft.threadId ? { threadId: draft.threadId } : {}),
        bodyPreview: preview.text,
        bodyChars: draft.body.length,
        notice:
          "Draft saved to the mailbox. It has not been sent; the user must review it.",
      };
    },
  });
}

/** `create_draft` — WRITE. Injectable for tests. */
export function createCreateDraftTool(
  deps: { drafts?: DraftService } = {},
): AnyToolDefinition {
  return buildCreateDraftTool(deps.drafts ?? draftService);
}

export const createDraftTool = buildCreateDraftTool(draftService);
