import { z } from "zod";

import { listOpenCommitments } from "@/lib/commitments/service";
import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";

import { requireReadPermission } from "./shared";

const inputSchema = z.object({
  threadId: z
    .string()
    .min(1)
    .max(256)
    .optional()
    .describe("Limit to one thread. Omit for every open promise."),
});

export type GetCommitmentsInput = z.infer<typeof inputSchema>;

function buildGetCommitmentsTool(): AnyToolDefinition {
  return defineTool({
    name: "get_commitments",
    description:
      "List the open promises in the user's mailbox, in both directions: 'we_owe' (the user promised) and 'they_owe' (the other side promised). Optionally scope to one thread. Use this before following up or when the user asks what they owe or are owed.",
    risk: "READ",
    inputSchema,
    authorize(ctx) {
      requireReadPermission(ctx);
    },
    async execute(ctx, input) {
      const rows = await listOpenCommitments({
        userId: ctx.userId,
        ...(input.threadId ? { threadId: input.threadId } : {}),
        limit: 50,
      });

      return {
        count: rows.length,
        commitments: rows.map((row) => ({
          id: row.id,
          threadId: row.threadId,
          direction: row.direction,
          description: row.description,
          dueAt: row.dueAt ? row.dueAt.toISOString() : null,
          overdue: row.dueAt ? row.dueAt.getTime() < Date.now() : false,
          nudges: row.nudgeCount,
        })),
      };
    },
  });
}

/** `get_commitments` — READ. */
export const getCommitmentsTool = buildGetCommitmentsTool();

export type GetCommitmentsOutput = Awaited<
  ReturnType<typeof getCommitmentsTool.execute>
>;
