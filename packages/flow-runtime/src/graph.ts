import type {
  EdgeCondition,
  FlowEdge,
  FlowGraph,
  FlowNode,
  GraphValidation,
} from "./types";

/**
 * Graph primitives. Everything here is pure and deterministic: a graph plus a
 * state object always yields the same node, which is what makes a resumed run
 * safe to continue.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Evaluates a guarded edge. All declared predicates must match; an undefined
 * guard means "always". Missing fields are `undefined`, so `notEquals` matches
 * an absent field (the same semantics the email flow relies on).
 */
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

/** The first node in graph order, or null for an empty graph. */
export function firstNode(graph: FlowGraph): FlowNode | null {
  return graph.nodes[0] ?? null;
}

/**
 * The first matching edge in array order. Determinism is intentional: a graph
 * author controls precedence by ordering mutually exclusive guards.
 */
export function selectNextEdge(
  graph: FlowGraph,
  node: FlowNode,
  state: Record<string, unknown>,
): FlowEdge | null {
  return (
    graph.edges.find(
      (candidate) =>
        candidate.from === node.id && evaluateCondition(candidate.when, state),
    ) ?? null
  );
}

/** Resolves the chosen edge to its target node (or null at a terminal edge). */
export function nextNode(
  graph: FlowGraph,
  node: FlowNode,
  state: Record<string, unknown>,
): FlowNode | null {
  const edge = selectNextEdge(graph, node, state);
  if (!edge) return null;
  return graph.nodes.find((candidate) => candidate.id === edge.to) ?? null;
}

/**
 * Structural validation run before a single step executes. It catches the
 * failure modes that would otherwise strand a run mid-graph: duplicate ids,
 * edges pointing at missing nodes, and malformed configs.
 */
export function validateGraph(graph: FlowGraph): GraphValidation {
  const errors: string[] = [];

  if (!isPlainObject(graph)) {
    return { valid: false, errors: ["graph must be an object"] };
  }
  if (!Array.isArray(graph.nodes)) {
    errors.push("nodes must be an array");
  }
  if (!Array.isArray(graph.edges)) {
    errors.push("edges must be an array");
  }
  if (errors.length > 0) return { valid: false, errors };

  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (!isPlainObject(node)) {
      errors.push("every node must be an object");
      continue;
    }
    if (typeof node.id !== "string" || node.id.length === 0) {
      errors.push("every node needs a non-empty string id");
      continue;
    }
    if (ids.has(node.id)) {
      errors.push(`duplicate node id "${node.id}"`);
    }
    ids.add(node.id);
    if (typeof node.type !== "string" || node.type.length === 0) {
      errors.push(`node "${node.id}" needs a non-empty string type`);
    }
    if (node.config !== undefined && !isPlainObject(node.config)) {
      errors.push(`node "${node.id}" config must be an object`);
    }
  }

  for (const edge of graph.edges) {
    if (!isPlainObject(edge)) {
      errors.push("every edge must be an object");
      continue;
    }
    if (typeof edge.from !== "string" || !ids.has(edge.from)) {
      errors.push(`edge from "${String(edge.from)}" has no matching node`);
    }
    if (typeof edge.to !== "string" || !ids.has(edge.to)) {
      errors.push(`edge to "${String(edge.to)}" has no matching node`);
    }
    if (edge.when !== undefined) {
      if (!isPlainObject(edge.when)) {
        errors.push(`edge ${String(edge.from)}→${String(edge.to)} has an invalid guard`);
      } else if (
        typeof edge.when.field !== "string" ||
        edge.when.field.length === 0
      ) {
        errors.push(
          `edge ${String(edge.from)}→${String(edge.to)} guard needs a field`,
        );
      }
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Returns the first node that has no incoming edge. Used by diagnostics; the
 * runtime always starts at `nodes[0]`, preserving authored order.
 */
export function entryNodes(graph: FlowGraph): FlowNode[] {
  const targets = new Set(graph.edges.map((edge) => edge.to));
  return graph.nodes.filter((node) => !targets.has(node.id));
}
