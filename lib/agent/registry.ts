import type { ZodType } from "zod";

import type { AgentContext } from "@/lib/agent/context";

/**
 * Tool registry.
 *
 * A tool is the only way the model can affect the application. It carries its
 * own Zod input schema, a fixed risk classification (never model-chosen), an
 * optional deterministic `authorize` check, and an `execute` function.
 *
 * The registry is intentionally storage-free and framework-free: it can be
 * unit tested without the AI SDK or a database. The loop converts definitions
 * into AI SDK tools at the boundary.
 */

export type ToolRisk = "READ" | "WRITE" | "EXTERNAL_SIDE_EFFECT";

export interface ToolDefinition<I = unknown, O = unknown> {
  /** Snake_case, stable — it is also the model-facing function name. */
  name: string;
  description: string;
  risk: ToolRisk;
  inputSchema: ZodType<I>;
  /**
   * Deterministic authorization, run after input validation and before
   * `execute`. Throwing here denies the call. The model never decides this.
   */
  authorize?: (ctx: AgentContext, input: I) => void | Promise<void>;
  execute: (ctx: AgentContext, input: I) => Promise<O>;
  /** Per-call wall-clock budget. Clamped to [MIN, MAX]. */
  timeoutMs?: number;
}

export const DEFAULT_TOOL_TIMEOUT_MS = 15_000;
export const MAX_TOOL_TIMEOUT_MS = 30_000;
export const MIN_TOOL_TIMEOUT_MS = 1_000;

export function resolveToolTimeout(timeoutMs?: number): number {
  if (typeof timeoutMs !== "number") return DEFAULT_TOOL_TIMEOUT_MS;
  return Math.min(Math.max(timeoutMs, MIN_TOOL_TIMEOUT_MS), MAX_TOOL_TIMEOUT_MS);
}

/**
 * Type-erased tool handle used inside the registry map. `unknown` is the honest
 * type for a heterogeneous collection; the only place that needs the concrete
 * input type validates it with the tool's own schema first.
 */
export type AnyToolDefinition = ToolDefinition<unknown, unknown>;

/**
 * Identity helper for declaring a tool.
 *
 * The concrete input type is inferred from `inputSchema` inside `execute`, then
 * erased at the boundary: the registry stores heterogeneous tools, and every
 * call re-validates input with the schema before `execute` runs.
 */
export function defineTool<I, O>(
  definition: ToolDefinition<I, O>,
): AnyToolDefinition {
  return definition as unknown as AnyToolDefinition;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();

  register(definition: AnyToolDefinition): this {
    if (this.tools.has(definition.name)) {
      throw new Error(`Duplicate tool registration: ${definition.name}`);
    }
    this.tools.set(definition.name, definition);
    return this;
  }

  registerAll(definitions: ReadonlyArray<AnyToolDefinition>): this {
    for (const definition of definitions) {
      this.register(definition);
    }
    return this;
  }

  get(name: string): AnyToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Insertion order, which is also the order handed to the model. */
  list(): AnyToolDefinition[] {
    return [...this.tools.values()];
  }

  get size(): number {
    return this.tools.size;
  }
}

export function createToolRegistry(
  definitions: ReadonlyArray<AnyToolDefinition> = [],
): ToolRegistry {
  const registry = new ToolRegistry();
  registry.registerAll(definitions);
  return registry;
}
