import "server-only";

import { z } from "zod";

import { defineStep } from "@/lib/engine/step";

/**
 * Terminal best-effort step: records a compact run summary to the log. The
 * authoritative trace already lives on `flow_runs.trace`; this is the seam for
 * phase-6 metrics.
 */
export const logTraceStep = defineStep({
  type: "log-trace",
  configSchema: z.object({}),
  policy: "best_effort",
  async run(ctx) {
    ctx.log("log-trace", {
      category: ctx.state.category ?? null,
      intent: ctx.state.intent ?? null,
      decision: ctx.state.decision ?? null,
      sent: ctx.state.sent ?? false,
    });
    return {};
  },
});
