import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { flows } from "@/lib/db/schema";

/**
 * Flow graph primitives + the seeded default flows. A graph is a list of nodes
 * (step type + config) and conditional edges evaluated against the run state.
 */

export type FlowNode = {
  id: string;
  type: string;
  config?: Record<string, unknown>;
};

export type EdgeCondition = {
  field: string;
  equals?: unknown;
  notEquals?: unknown;
  truthy?: boolean;
};

export type FlowEdge = {
  from: string;
  to: string;
  when?: EdgeCondition;
};

export type FlowGraph = {
  nodes: FlowNode[];
  edges: FlowEdge[];
};

export const INBOUND_EMAIL_FLOW_NAME = "inbound-email";

/** The default intelligent-inbox pipeline (see plan §5.4 / §7). */
export function buildInboundEmailGraph(): FlowGraph {
  return {
    nodes: [
      { id: "t", type: "triage" },
      { id: "c", type: "classify-intent" },
      { id: "l", type: "load-context" },
      { id: "m", type: "detect-meeting-intent" },
      { id: "s", type: "find-free-slots", config: { count: 3, horizonDays: 7 } },
      { id: "p", type: "propose-times", config: { maxOptions: 3 } },
      { id: "d", type: "draft-reply", config: { maxParagraphs: 3 } },
      { id: "g", type: "guardrails" },
      { id: "e", type: "egress" },
      { id: "x", type: "send-email" },
      { id: "f", type: "schedule-followup", config: { afterDays: 3 } },
      { id: "r", type: "log-trace" },
    ],
    edges: [
      { from: "t", to: "c" },
      { from: "c", to: "l" },
      { from: "l", to: "m" },
      { from: "m", to: "s", when: { field: "isMeeting", truthy: true } },
      { from: "m", to: "d", when: { field: "isMeeting", notEquals: true } },
      { from: "s", to: "p" },
      { from: "p", to: "d" },
      { from: "d", to: "g" },
      { from: "g", to: "e" },
      { from: "e", to: "x", when: { field: "decision", equals: "send" } },
      { from: "e", to: "f", when: { field: "decision", equals: "draft" } },
      { from: "x", to: "f" },
      { from: "f", to: "r" },
    ],
  };
}

export function firstNode(graph: FlowGraph): FlowNode | null {
  return graph.nodes[0] ?? null;
}

export function evaluateCondition(
  condition: EdgeCondition | undefined,
  state: Record<string, unknown>,
): boolean {
  if (!condition) return true;
  const value = state[condition.field];

  if ("equals" in condition && value !== condition.equals) return false;
  if ("notEquals" in condition && value === condition.notEquals) return false;
  if (condition.truthy !== undefined && Boolean(value) !== condition.truthy) {
    return false;
  }
  return true;
}

/** Returns the first edge from `node` whose condition matches `state`. */
export function nextNode(
  graph: FlowGraph,
  node: FlowNode,
  state: Record<string, unknown>,
): FlowNode | null {
  const edge = graph.edges.find(
    (candidate) =>
      candidate.from === node.id && evaluateCondition(candidate.when, state),
  );
  if (!edge) return null;
  return graph.nodes.find((candidate) => candidate.id === edge.to) ?? null;
}

export type FlowRow = typeof flows.$inferSelect;

/**
 * Ensures the default inbound-email flow exists for a user and returns it.
 * Idempotent: repeated calls return the existing row.
 */
export async function seedDefaultFlows(userId: string): Promise<FlowRow> {
  const existing = await db
    .select()
    .from(flows)
    .where(
      and(
        eq(flows.userId, userId),
        eq(flows.name, INBOUND_EMAIL_FLOW_NAME),
      ),
    )
    .limit(1);

  if (existing[0]) return existing[0];

  const inserted = await db
    .insert(flows)
    .values({
      id: nanoid(),
      userId,
      name: INBOUND_EMAIL_FLOW_NAME,
      graph: buildInboundEmailGraph() as unknown as Record<string, unknown>,
      isActive: true,
    })
    .returning();

  return inserted[0];
}
