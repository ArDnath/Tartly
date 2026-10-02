import "server-only";

import { z } from "zod";

import { extractCommitmentsForThread } from "@/lib/commitments/service";
import { defineStep } from "@/lib/engine/step";
import { requireThreadId } from "./helpers";

/**
 * Best-effort promise extraction (`they_owe` / `we_owe`). One `fast` structured
 * call per thread with a deterministic empty fallback, so a model outage simply
 * yields no new commitments. Honors the per-user `commitmentsEnabled` setting.
 */
export const extractCommitmentsStep = defineStep({
  type: "extract-commitments",
  policy: "best_effort",
  configSchema: z.object({}),
  async run(ctx) {
    const threadId = requireThreadId(ctx);
    const rows = await extractCommitmentsForThread({
      userId: ctx.userId,
      threadId,
    });
    ctx.log("extract-commitments", { stored: rows.length });
    return { commitmentIds: rows.map((row) => row.id) };
  },
});
