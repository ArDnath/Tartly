import "server-only";

import { nanoid } from "nanoid";
import { z } from "zod";

import {
  DRAFT_PIPELINE_VERSION,
  buildDraftContext,
  buildDraftContextPrompt,
  getAssistantSettings,
  meetsConfidenceRequirement,
  type ConfidenceLevel,
} from "@/lib/ai/features/draft-context";
import { generateObject } from "@/lib/ai/generate";
import { defineStep } from "@/lib/engine/step";
import { loadThreadContext } from "@/lib/email-operator/thread-context";
import { draftRepository } from "@/lib/repositories/drafts";
import { engineDraftRepository } from "@/lib/repositories/engine-drafts";
import { userRepository } from "@/lib/repositories/users";
import { requireThreadId } from "./helpers";

type DraftState = {
  latestMessage?: { from?: string | null; subject?: string | null; text?: string | null } | null;
  contact?: { name?: string | null; email?: string | null } | null;
  history?: Array<{ direction: string; text: string | null }>;
  options?: string[];
};

function readDraftState(state: Record<string, unknown>): DraftState {
  return {
    latestMessage: (state.latestMessage as DraftState["latestMessage"]) ?? null,
    contact: (state.contact as DraftState["contact"]) ?? null,
    history: Array.isArray(state.history) ? (state.history as DraftState["history"]) : [],
    options: Array.isArray(state.options) ? (state.options as string[]) : [],
  };
}

/** Deterministic reply used when no model is configured. */
export function buildFallbackDraft({
  recipientName,
  subject,
  senderName,
  options,
}: {
  recipientName: string | null;
  subject: string | null;
  senderName: string;
  options: string[];
}): string {
  const greeting = recipientName ? `Hi ${recipientName.split(" ")[0]},` : "Hi,";
  const about = subject ? ` about “${subject}”` : "";

  const lines = [
    greeting,
    "",
    `Thanks for reaching out${about}. I've read your note and I'm on it.`,
  ];

  if (options.length > 0) {
    lines.push(
      "",
      "A few times that work on my side:",
      ...options.map((option) => `- ${option}`),
      "",
      "Let me know which suits you and I'll send an invite.",
    );
  } else {
    lines.push(
      "",
      "I'll get back to you shortly with the details you need.",
    );
  }

  lines.push("", "Best,", senderName);
  return lines.join("\n");
}

const SYSTEM_PROMPT =
  "You draft concise, warm, professional email replies for an executive " +
  "assistant. Reply in the sender's language. Never invent commitments, " +
  "prices or dates that are not in the provided context. Keep it under 150 words.";

export const draftReplyStep = defineStep({
  type: "draft-reply",
  configSchema: z.object({
    maxParagraphs: z.number().int().positive().max(10).optional(),
    tone: z.string().max(40).optional(),
  }),
  async run(ctx) {
    const threadId = requireThreadId(ctx);
    const state = readDraftState(ctx.state);

    // Fall back to a fresh read when load-context did not run (e.g. tests).
    let latest = state.latestMessage;
    let contact = state.contact;
    if (!latest) {
      const context = await loadThreadContext({ userId: ctx.userId, threadId, historyLimit: 6 });
      latest = context?.latestInbound
        ? {
            from: context.latestInbound.fromAddr,
            subject: context.latestInbound.subject,
            text: context.latestInbound.bodyText,
          }
        : null;
      contact = context?.contact
        ? { name: context.contact.name, email: context.contact.email }
        : null;
    }

    const senderName =
      (await userRepository.findNameById(ctx.userId)) ?? "The team";

    const options = state.options ?? [];
    const optionBlock = options.length
      ? `\n\nProposed times: ${options.join(", ")}`
      : "";

    // A matching plain-English rule can steer the reply (Phase 3).
    const ruleInstruction =
      typeof ctx.state.draftInstruction === "string"
        ? ctx.state.draftInstruction
        : null;
    const ruleBlock = ruleInstruction
      ? `\n\nFollow this instruction for the reply: ${ruleInstruction}`
      : "";

    // Personalization: voice + memory + knowledge, all deterministic to fetch
    // and free when empty. Bounded; never blocks the draft.
    const context = await buildDraftContext({
      userId: ctx.userId,
      senderEmail: contact?.email ?? latest?.from ?? "",
      subject: latest?.subject ?? null,
      text: latest?.text ?? "",
      threadId,
    });
    const contextBlock = buildDraftContextPrompt(context);
    const config = await getAssistantSettings(ctx.userId);

    const ai = await generateObject({
      schema: z.object({
        body: z.string().min(1).max(4_000),
        confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
      }),
      role: "standard",
      feature: "draft-reply",
      system: `${SYSTEM_PROMPT}${ctx.input.tone ? ` Tone: ${ctx.input.tone}.` : ""}`,
      prompt: [
        contextBlock,
        contextBlock ? "" : undefined,
        `Reply to: ${contact?.name ?? contact?.email ?? latest?.from ?? "unknown"}`,
        `Subject: ${latest?.subject ?? "(none)"}`,
        `Their message:\n${latest?.text ?? "(empty)"}`,
        optionBlock,
        ruleBlock,
        "",
        "Return the reply body and your confidence in it (LOW, MEDIUM or HIGH).",
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n"),
      hardening: { trust: "untrusted", level: "full", outputConstraint: "plain-text" },
      maxOutputTokens: 1_000,
      userId: ctx.userId,
    });

    const body =
      ai?.body ??
      buildFallbackDraft({
        recipientName: contact?.name ?? null,
        subject: latest?.subject ?? null,
        senderName,
        options,
      });

    const confidence: ConfidenceLevel | null = ai?.confidence ?? null;
    // Only a model-produced draft can be "low confidence". A deterministic
    // template is always shown — suppressing it would confuse the user.
    const suppressed =
      ai !== null &&
      !meetsConfidenceRequirement({
        draftConfidence: confidence,
        minimum: config.draftConfidence,
      });

    // One pending draft per thread: regenerate updates it in place.
    const existing = await draftRepository.findAnyPendingByThread(threadId);

    let draftId: string;
    if (existing) {
      draftId = existing.id;
      await engineDraftRepository.updatePending({
        draftId,
        body,
        runId: ctx.runId,
        editedBody: null,
        confidence,
        suppressed,
        pipelineVersion: DRAFT_PIPELINE_VERSION,
      });
    } else {
      draftId = nanoid();
      await engineDraftRepository.insert({
        id: draftId,
        userId: ctx.userId,
        threadId,
        runId: ctx.runId,
        body,
        status: "pending",
        confidence,
        suppressed,
        pipelineVersion: DRAFT_PIPELINE_VERSION,
      });
    }

    ctx.log("draft-reply", {
      draftId,
      length: body.length,
      confidence,
      suppressed,
      pipelineVersion: DRAFT_PIPELINE_VERSION,
    });
    return { body, draftId, confidence, suppressed };
  },
});
