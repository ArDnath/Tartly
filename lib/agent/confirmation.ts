import type { AgentContext } from "@/lib/agent/context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/agent/errors";
import type { ToolRegistry, ToolRisk } from "@/lib/agent/registry";
import type { ActionExecutor } from "@/lib/services/action-service";

/**
 * Confirmation contract.
 *
 * The loop never persists anything itself (the runtime layer must not touch a
 * DB module). Instead it hands a `ConfirmationRequest` to a handler the route
 * supplies. The handler creates the pending action and returns the value that
 * streams back to the model as the tool result.
 *
 * `createRegistryActionExecutor` is the inverse: given the tool registry and
 * the server-built context, it produces the executor the ActionService calls
 * *after* the user's confirmation. Reusing the tool's own `execute` means there
 * is exactly one implementation of a side effect.
 */

export interface ConfirmationRequest {
  ctx: AgentContext;
  toolName: string;
  risk: ToolRisk;
  /** Validated tool input. */
  input: Record<string, unknown>;
  toolCallId: string;
  step: number;
}

export type ConfirmationHandler = (
  request: ConfirmationRequest,
) => Promise<unknown>;

/** What the model receives when a side effect is deferred to the user. */
export interface ConfirmationRequiredResult {
  status: "confirmation_required";
  pendingActionId: string;
  tool: string;
  expiresAt: string;
  notice: string;
}

export function confirmationRequiredResult(input: {
  pendingActionId: string;
  toolName: string;
  expiresAt: Date;
}): ConfirmationRequiredResult {
  return {
    status: "confirmation_required",
    pendingActionId: input.pendingActionId,
    tool: input.toolName,
    expiresAt: input.expiresAt.toISOString(),
    notice:
      "This action needs the user's explicit confirmation. It has NOT run. Tell the user what you are ready to do and wait for them to confirm.",
  };
}

/**
 * Turn a tool definition into a confirm-time executor.
 *
 * Deliberately bypasses the permission *decision*: the user's server-verified
 * confirmation is the authorisation. It still re-validates the frozen arguments
 * and runs the tool's own `authorize` gate, so a revoked or narrowed account
 * cannot execute a stale action.
 */
export function createRegistryActionExecutor(input: {
  registry: ToolRegistry;
  ctx: AgentContext;
}): ActionExecutor {
  return async ({ action, args }) => {
    const tool = input.registry.get(action.toolName);
    if (!tool) {
      throw new NotFoundError("That action is no longer available.");
    }
    if (tool.risk !== "EXTERNAL_SIDE_EFFECT") {
      throw new ConflictError("This action is not a confirmable side effect.");
    }

    const parsed = tool.inputSchema.safeParse(args);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const detail = issue
        ? `${issue.path.join(".") || "input"}: ${issue.message}`
        : "invalid input";
      throw new ValidationError(`The action arguments are invalid (${detail}).`);
    }

    // The user's confirmation is the authorization, but a revoked or narrowed
    // account must still be refused.
    await tool.authorize?.(input.ctx, parsed.data);

    // The action identity is injected here and nowhere else: a side-effect tool
    // refuses to run without it, which is what makes "no confirmation, no
    // effect" a code invariant rather than a convention.
    return tool.execute(
      {
        ...input.ctx,
        pendingActionId: action.id,
        idempotencyKey: action.idempotencyKey,
      },
      parsed.data,
    );
  };
}
