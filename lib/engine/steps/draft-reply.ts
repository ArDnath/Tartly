import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { AI_DRAFT_MODEL_ID } from "@/lib/ai/provider";
import { generateStructured } from "@/lib/ai/structured";
import { db } from "@/lib/db";
import { drafts, user } from "@/lib/db/schema";
import { defineStep } from "@/lib/engine/step";
import { loadThreadContext } from "@/lib/email-operator/thread-context";
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

    const senderRows = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, ctx.userId))
      .limit(1);
    const senderName = senderRows[0]?.name ?? "The team";

    const options = state.options ?? [];
    const optionBlock = options.length
      ? `\n\nProposed times: ${options.join(", ")}`
      : "";

    const ai = await generateStructured({
      schema: z.object({ body: z.string().min(1).max(4_000) }),
      system: `${SYSTEM_PROMPT}${ctx.input.tone ? ` Tone: ${ctx.input.tone}.` : ""}`,
      prompt: [
        `Reply to: ${contact?.name ?? contact?.email ?? latest?.from ?? "unknown"}`,
        `Subject: ${latest?.subject ?? "(none)"}`,
        `Their message:\n${latest?.text ?? "(empty)"}`,
        optionBlock,
      ].join("\n"),
      modelId: AI_DRAFT_MODEL_ID,
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

    // One pending draft per thread: regenerate updates it in place.
    const existing = await db
      .select({ id: drafts.id })
      .from(drafts)
      .where(and(eq(drafts.threadId, threadId), eq(drafts.status, "pending")))
      .limit(1);

    let draftId: string;
    if (existing[0]) {
      draftId = existing[0].id;
      await db
        .update(drafts)
        .set({ body, runId: ctx.runId, editedBody: null })
        .where(eq(drafts.id, draftId));
    } else {
      draftId = nanoid();
      await db.insert(drafts).values({
        id: draftId,
        userId: ctx.userId,
        threadId,
        runId: ctx.runId,
        body,
        status: "pending",
      });
    }

    ctx.log("draft-reply", { draftId, length: body.length });
    return { body, draftId };
  },
});
