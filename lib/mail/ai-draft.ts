import "server-only";

import { generateText } from "ai";

import { isBudgetDisabled, tryConsumeAiBudget } from "@/lib/ai/budget";
import { AI_DRAFT_MODEL_ID, getModel } from "@/lib/ai/provider";

/**
 * "Draft with AI" for the composer. It only ever returns a body — the compose
 * dialog puts it in the textarea for the user to review and edit, and sending
 * is a separate, explicit action. Falls back to a deterministic draft when no
 * model is configured so the button always does something.
 */

const SYSTEM = [
  "You are an expert email assistant.",
  "Write a concise, warm, professional email body.",
  "Output only the body — no subject line, no placeholders like [Name],",
  "no markdown formatting, and no signature block.",
].join(" ");

export type MailDraftSource = "ai" | "fallback";

export async function generateMailBody({
  userId,
  to,
  subject,
  instruction,
}: {
  userId: string;
  to: string[];
  subject: string;
  instruction?: string;
}): Promise<{ body: string; source: MailDraftSource }> {
  const model = getModel(AI_DRAFT_MODEL_ID);

  if (model) {
    const allowed = isBudgetDisabled() || (await tryConsumeAiBudget({ userId }));
    if (allowed) {
      const prompt = [
        `Recipients: ${to.length ? to.join(", ") : "(unknown)"}`,
        subject ? `Subject: ${subject}` : "Subject: (none)",
        instruction?.trim() ? `Instruction: ${instruction.trim()}` : "",
        "Write the email body.",
      ]
        .filter(Boolean)
        .join("\n");

      try {
        const { text } = await generateText({ model, system: SYSTEM, prompt });
        const body = text.trim();
        if (body) return { body, source: "ai" };
      } catch (error) {
        console.error("[mail/ai-draft] generation failed", error);
      }
    }
  }

  return {
    body: buildFallbackDraft({ subject, instruction }),
    source: "fallback",
  };
}

/** Deterministic body so the button works without an AI key. */
function buildFallbackDraft({
  subject,
  instruction,
}: {
  subject: string;
  instruction?: string;
}): string {
  const topic = instruction?.trim() || subject.trim() || "your message";
  return `Hi,

Thanks for reaching out${subject ? ` about "${subject}"` : ""}. I wanted to follow up on ${topic}.

Could you share a little more detail so I can point you in the right direction? Happy to jump on a quick call if that's easier.

Best,`;
}
