import "server-only";

import { z } from "zod";

import { db } from "@/lib/db";
import { threadStates } from "@/lib/db/schema";
import { defineStep } from "@/lib/engine/step";
import { requireThreadId } from "./helpers";

/**
 * Hands a thread to a human. Marks the thread's action as `handoff` so it lands
 * in the inbox's "needs you" queue with an explicit reason.
 */
export const handoffStep = defineStep({
  type: "handoff",
  configSchema: z.object({ reason: z.string().max(200).default("needs_human") }),
  async run(ctx) {
    const threadId = requireThreadId(ctx);

    await db
      .insert(threadStates)
      .values({
        threadId,
        category: "needs_reply",
        priority: 90,
        action: "handoff",
      })
      .onConflictDoUpdate({
        target: threadStates.threadId,
        set: { action: "handoff", priority: 90, updatedAt: new Date() },
      });

    ctx.log("handoff", { reason: ctx.input.reason });
    return { notified: true };
  },
});
