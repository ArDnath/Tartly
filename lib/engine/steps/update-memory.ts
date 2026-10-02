import "server-only";

import { z } from "zod";

import { getAssistantSettings } from "@/lib/ai/features/draft-context";
import { learnFromExchange } from "@/lib/ai/features/reply-memory";
import { defineStep } from "@/lib/engine/step";
import { isAssistantAutoMemoryEnabled } from "@/lib/env";
import { requireThreadId } from "./helpers";

type MemoryState = {
  latestMessage?: { from?: string | null; text?: string | null } | null;
  contact?: { email?: string | null } | null;
};

/**
 * Best-effort auto-memory. Runs after a draft/send and learns durable facts
 * from the exchange — but only when the user has explicitly opted in
 * (`assistantSettings.memoryAutoExtract`, default off). With the toggle off this
 * step does nothing, so behavior is byte-for-byte the pre-feature default.
 */
export const updateMemoryStep = defineStep({
  type: "update-memory",
  policy: "best_effort",
  configSchema: z.object({}),
  async run(ctx) {
    const threadId = requireThreadId(ctx);

    if (!isAssistantAutoMemoryEnabled()) return { memoriesStored: 0 };
    const config = await getAssistantSettings(ctx.userId);
    if (!config.memoryAutoExtract) return { memoriesStored: 0 };

    const state = ctx.state as MemoryState;
    const incoming = state.latestMessage?.text ?? "";
    const reply = typeof ctx.state.body === "string" ? ctx.state.body : "";
    if (!incoming.trim() || !reply.trim()) return { memoriesStored: 0 };

    const senderEmail =
      state.contact?.email ?? state.latestMessage?.from ?? "";
    if (!senderEmail) return { memoriesStored: 0 };

    const { stored } = await learnFromExchange({
      userId: ctx.userId,
      senderEmail,
      incoming,
      reply,
      sourceThreadId: threadId,
    });

    ctx.log("update-memory", { stored });
    return { memoriesStored: stored };
  },
});
