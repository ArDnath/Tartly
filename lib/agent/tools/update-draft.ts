import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import {
  DraftService,
  draftService,
  type DraftPatch,
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

const patchSchema = z.object({
  to: z
    .array(recipientSchema)
    .min(1)
    .max(MAX_DRAFT_RECIPIENTS)
    .optional()
    .describe("Replace the recipient list."),
  cc: z
    .array(recipientSchema)
    .max(MAX_DRAFT_RECIPIENTS)
    .optional()
    .describe("Replace the Cc list."),
  bcc: z
    .array(recipientSchema)
    .max(MAX_DRAFT_RECIPIENTS)
    .optional()
    .describe("Replace the Bcc list."),
  subject: z
    .string()
    .max(MAX_DRAFT_SUBJECT_CHARS)
    .optional()
    .describe("Replace the subject."),
  body: z
    .string()
    .min(1)
    .max(MAX_DRAFT_BODY_CHARS)
    .optional()
    .describe("Replace the body."),
  threadId: z
    .string()
    .max(256)
    .optional()
    .describe("Set or change the conversation this draft replies into."),
  inReplyTo: z
    .string()
    .max(998)
    .optional()
    .describe("Set or change the Message-ID this draft replies to."),
});

const inputSchema = z
  .object({
    draftId: z
      .string()
      .min(1)
      .max(256)
      .describe("The draft id returned by create_draft."),
    expectedVersion: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .describe(
        "The `version` returned when the draft was created or last read. Pass it so a newer edit is never silently overwritten.",
      ),
  })
  .extend(patchSchema.shape)
  .refine(
    (value) =>
      [
        value.to,
        value.cc,
        value.bcc,
        value.subject,
        value.body,
        value.threadId,
        value.inReplyTo,
      ].some((field) => field !== undefined),
    { message: "Provide at least one field to change." },
  );

export type UpdateDraftInput = z.infer<typeof inputSchema>;

function buildUpdateDraftTool(drafts: DraftService): AnyToolDefinition {
  return defineTool({
    name: "update_draft",
    description:
      "Edit an existing draft's recipients, subject, body or threading. Only the fields you pass are changed; the rest are preserved. Pass `expectedVersion` from create_draft (or the last update) so you never overwrite a newer edit.",
    risk: "WRITE",
    inputSchema,
    authorize(ctx) {
      requireWritePermission(ctx);
    },
    async execute(ctx, input) {
      const patch: DraftPatch = {};
      if (input.to !== undefined) patch.to = input.to;
      if (input.cc !== undefined) patch.cc = input.cc;
      if (input.bcc !== undefined) patch.bcc = input.bcc;
      if (input.subject !== undefined) patch.subject = input.subject;
      if (input.body !== undefined) patch.body = input.body;
      if (input.threadId !== undefined) patch.threadId = input.threadId;
      if (input.inReplyTo !== undefined) patch.inReplyTo = input.inReplyTo;

      const draft = await drafts.updateDraft({
        userId: ctx.userId,
        draftId: input.draftId,
        ...(input.expectedVersion
          ? { expectedVersion: input.expectedVersion }
          : {}),
        patch,
      });

      const preview = truncate(draft.body, DRAFT_BODY_PREVIEW_CHARS);
      return {
        draftId: draft.id,
        version: draft.version,
        updatedAt: draft.updatedAt,
        to: draft.to,
        subject: draft.subject,
        ...(draft.threadId ? { threadId: draft.threadId } : {}),
        bodyPreview: preview.text,
        bodyChars: draft.body.length,
        notice: "Draft updated. It has not been sent.",
      };
    },
  });
}

/** `update_draft` — WRITE. Injectable for tests. */
export function createUpdateDraftTool(
  deps: { drafts?: DraftService } = {},
): AnyToolDefinition {
  return buildUpdateDraftTool(deps.drafts ?? draftService);
}

export const updateDraftTool = buildUpdateDraftTool(draftService);
