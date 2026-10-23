import { createUIMessageStreamResponse } from "ai";
import { randomUUID } from "node:crypto";

import { buildAgentContext } from "@/lib/agent/context";
import { streamAgentTurn } from "@/lib/agent/loop";
import { isBudgetDisabled, tryConsumeAiBudget } from "@/lib/ai/budget";
import {
  buildComposeAgentPrompt,
  buildComposeAgentSystemPrompt,
  createComposeAgentRegistry,
} from "@/lib/ai/features/compose-agent";
import { getModelProvider } from "@/lib/ai/model-provider";
import { recordAiUsage } from "@/lib/ai/usage";
import { mailComposeAgentBody as schema } from "@/lib/api/contracts/mail";
import { apiError, type UserRouteHandler } from "@/lib/api/http";
import { agentRateLimitPerMin } from "@/lib/env";
import { withMailUser } from "@/lib/mail/route";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * "Write with AI" in the composer, backed by the same agent runtime and stream
 * as the assistant space. The client renders the identical thinking/tool-step
 * UI, then reads the `deliver_composer_draft` tool result off the stream to fill
 * the form. This route never writes to Gmail and never sends.
 */
const handleCompose: UserRouteHandler = async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("validation", "Invalid request.", 400);

  const { text, compose } = parsed.data;

  if (!isBudgetDisabled() && !(await tryConsumeAiBudget({ userId }))) {
    return apiError(
      "rate_limited",
      "Daily AI limit reached. Try again tomorrow.",
      429,
    );
  }

  const model = getModelProvider().getLanguageModel("standard");
  if (!model) {
    return apiError(
      "unavailable",
      "The AI model is not configured, so I can't write that right now.",
      503,
    );
  }

  const requestId = randomUUID();
  const startedAt = Date.now();
  const ctx = await buildAgentContext({
    userId,
    // A composer turn is not a chat thread; the id only names the run for
    // audit, so no conversation row is created.
    conversationId: `compose:${requestId}`,
    requestId,
  });

  const stream = streamAgentTurn({
    ctx,
    model,
    system: buildComposeAgentSystemPrompt({
      now: ctx.now,
      timezone: ctx.timezone,
    }),
    messages: [
      {
        role: "user",
        content: buildComposeAgentPrompt({
          instruction: text,
          to: compose?.to ?? [],
          cc: compose?.cc ?? [],
          bcc: compose?.bcc ?? [],
          subject: compose?.subject ?? "",
          body: compose?.body ?? "",
        }),
      },
    ],
    registry: createComposeAgentRegistry(),
    abortSignal: request.signal,
    onStreamError: () => "The assistant failed to compose that email.",
    onFinish: (summary) =>
      recordAiUsage({
        userId,
        feature: "compose-agent",
        provider: getModelProvider().id,
        model: process.env.AI_MODEL_ID ?? "unknown",
        role: "standard",
        promptTokens: summary.promptTokens,
        completionTokens: summary.outputTokens,
        latencyMs: Date.now() - startedAt,
        ok: summary.status !== "failed",
        errorCode: summary.errorCode ?? null,
      }),
  });

  return createUIMessageStreamResponse({ stream });
};

export const POST = withMailUser(
  {
    rateLimit: { limit: agentRateLimitPerMin(), scope: "agent" },
    requiresSubscription: true,
  },
  handleCompose,
);
