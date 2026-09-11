import type { StepCtx } from "@/lib/engine/step";

/**
 * Trigger shape shared by every step in the inbound-email flow. The job handler
 * seeds `state.trigger` with the thread/mailbox being processed.
 */
export type FlowTrigger = {
  threadId?: string;
  mailboxId?: string;
};

export function readTrigger(state: Record<string, unknown>): FlowTrigger {
  const trigger = state.trigger;
  if (typeof trigger === "object" && trigger !== null) {
    return trigger as FlowTrigger;
  }
  return {};
}

export function requireThreadId(ctx: StepCtx): string {
  const { threadId } = readTrigger(ctx.state);
  if (!threadId) {
    throw new Error("Flow trigger is missing threadId.");
  }
  return threadId;
}

/** Reads a string field off the accumulated run state, if present. */
export function stateString(
  state: Record<string, unknown>,
  key: string,
): string | null {
  const value = state[key];
  return typeof value === "string" ? value : null;
}

export function stateBoolean(
  state: Record<string, unknown>,
  key: string,
): boolean {
  return state[key] === true;
}
