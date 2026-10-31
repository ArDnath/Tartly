import { z } from "zod";

import { ValidationError } from "@/lib/agent/errors";
import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import {
  DRAFT_PIPELINE_VERSION,
  buildDraftContext,
  buildDraftContextPrompt,
} from "@/lib/ai/features/draft-context";
import { generateObject } from "@/lib/ai/generate";
import { buildFallbackDraft } from "@/lib/engine/steps/draft-reply";
import { loadThreadContext } from "@/lib/email-operator/thread-context";
import {
  DraftService,
  draftService,
} from "@/lib/services/draft-service";

import {
  DRAFT_BODY_PREVIEW_CHARS,
  recipientSchema,
  requireWritePermission,
  truncate,
} from "./shared";

/**
 * `draft_in_my_voice` — WRITE.
 *
 * Writes a reply (or a new email) that matches the user's learned style and
 * reuses their saved knowledge and reply memories. Saves it to the mailbox as a
 * draft only; it is never sent. This is the conversational front door to the
 * Phase 1 voice/memory capability.
 */

const inputSchema = z
  .object({
    threadId: z
      .string()
      .max(256)
      .optional()
      .describe(
        "Reply within this existing thread. Provide it whenever the user asks to reply.",
      ),
    to: z
      .array(recipientSchema)
      .min(1)
      .max(20)
      .optional()
      .describe("Recipients for a brand-new email (omit when threadId is set)."),
    subject: z
      .string()
      .max(500)
      .optional()
      .describe("Subject for a new email (omit when replying)."),
    instructions: z
      .string()
      .min(1)
      .max(2_000)
      .describe("What the message should say, in the user's own words."),
    tone: z.string().max(60).optional().describe("Optional tone override."),
  })
  .refine((value) => Boolean(value.threadId || value.to?.length), {
    message: "Provide a threadId to reply, or `to` recipients for a new email.",
    path: ["to"],
  });

export type DraftInMyVoiceInput = z.infer<typeof inputSchema>;

function buildDraftInMyVoiceTool(drafts: DraftService): AnyToolDefinition {
  return defineTool({
    name: "draft_in_my_voice",
    description:
      "Draft an email that sounds like the user, using their learned writing style, saved knowledge, and past reply preferences. Provide the threadId to reply in a thread, or `to` for a new email, plus `instructions` describing what to say. Saves a draft to the mailbox for review; nothing is sent. When you need a generic draft without personalization, create_draft is fine; use this when the user wants it to sound like them.",
    risk: "WRITE",
    inputSchema,
    authorize(ctx) {
      requireWritePermission(ctx);
    },
    async execute(ctx, input) {
      let recipient: string | null = input.to?.[0] ?? null;
      let subject = input.subject?.trim() ?? "";
      let incomingText = "";
      // The provider's own thread id (Gmail raw, Outlook `outlook:`-prefixed).
      // The input may be the internal mirror id, which no provider understands.
      let providerThreadId: string | null = null;

      if (input.threadId) {
        const context = await loadThreadContext({
          userId: ctx.userId,
          threadId: input.threadId,
          historyLimit: 8,
        });
        if (!context) {
          throw new ValidationError("That conversation was not found.");
        }
        recipient =
          context.latestInbound?.fromAddr ?? context.contact?.email ?? recipient;
        const threadSubject = context.thread.subject?.trim();
        if (!subject && threadSubject) {
          subject = /^re:/i.test(threadSubject)
            ? threadSubject
            : `Re: ${threadSubject}`;
        }
        incomingText = context.latestInbound?.bodyText ?? "";
        providerThreadId = context.thread.gmailThreadId ?? null;
      }

      if (!recipient) {
        throw new ValidationError(
          "No recipient could be found for this draft.",
        );
      }

      const draftContext = await buildDraftContext({
        userId: ctx.userId,
        senderEmail: recipient,
        subject: subject || null,
        text: `${incomingText}\n${input.instructions}`,
      });

      const ai = await generateObject({
        schema: z.object({
          body: z.string().min(1).max(8_000),
          confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
        }),
        role: "standard",
        feature: "draft-in-my-voice",
        userId: ctx.userId,
        system:
          "You draft email on behalf of the user, in their voice. Follow the supplied writing style, saved knowledge, and reply memories. Never invent facts, prices, dates or commitments that are not in the provided context. Reply in the language of the thread. Return the body and your confidence in it.",
        prompt: [
          buildDraftContextPrompt(draftContext),
          buildDraftContextPrompt(draftContext) ? "" : undefined,
          `Recipient: ${recipient}`,
          `Subject: ${subject || "(none)"}`,
          incomingText ? `Their message:\n${incomingText}` : undefined,
          `What to say:\n${input.instructions}`,
          input.tone ? `Tone: ${input.tone}` : undefined,
          "",
          "Write the email body. Do not include a subject line.",
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n"),
        hardening: {
          trust: "untrusted",
          level: "full",
          outputConstraint: "plain-text",
        },
        maxOutputTokens: 1_200,
      });

      const body =
        ai?.body ??
        buildFallbackDraft({
          recipientName: null,
          subject: subject || null,
          senderName: "The team",
          options: [],
        });

      const draft = await drafts.createDraft({
        userId: ctx.userId,
        to: [recipient],
        ...(subject ? { subject } : {}),
        body,
        ...(providerThreadId ? { threadId: providerThreadId } : {}),
      });

      const preview = truncate(draft.body, DRAFT_BODY_PREVIEW_CHARS);
      return {
        draftId: draft.id,
        version: draft.version,
        to: draft.to,
        subject: draft.subject,
        confidence: ai?.confidence ?? null,
        pipelineVersion: DRAFT_PIPELINE_VERSION,
        bodyPreview: preview.text,
        bodyChars: draft.body.length,
        notice:
          "Draft saved to the mailbox in the user's voice. It has not been sent.",
      };
    },
  });
}

/** `draft_in_my_voice` — WRITE. Injectable for tests. */
export function createDraftInMyVoiceTool(
  deps: { drafts?: DraftService } = {},
): AnyToolDefinition {
  return buildDraftInMyVoiceTool(deps.drafts ?? draftService);
}

export const draftInMyVoiceTool = buildDraftInMyVoiceTool(draftService);
