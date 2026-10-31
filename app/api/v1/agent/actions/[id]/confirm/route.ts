import { randomUUID } from "node:crypto";

import { createRegistryActionExecutor } from "@/lib/agent/confirmation";
import { buildAgentContext } from "@/lib/agent/context";
import { toSafeError } from "@/lib/agent/errors";
import { createLoggingEventSink } from "@/lib/agent/events";
import { createDefaultToolRegistry } from "@/lib/agent/tools";
import { confirmActionBody as bodySchema } from "@/lib/api/contracts/agent";
import { apiError, apiErrorFrom, ok, withUser } from "@/lib/api/http";
import { connectedMailProviders } from "@/lib/mail/accounts";
import { actionService, toActionDto } from "@/lib/services/action-service";

/**
 * POST /api/v1/agent/actions/[id]/confirm
 *
 * The user's server-verified consent. The checklist, in order:
 *   authenticate → ownership → status/expiry → hash match → provider account →
 *   atomic PENDING → EXECUTING → execute the tool's own `execute` → terminal
 *   SUCCEEDED/FAILED.
 *
 * Every step before the atomic transition is a guard; the race itself is won or
 * lost by the conditional UPDATE inside `ActionService.confirmAction`.
 */

export const POST = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, request, context) => {
    const { id } = await context.params;
    const parsed = bodySchema.safeParse(
      await request.json().catch(() => ({})),
    );
    if (!parsed.success) {
      return apiError("validation", "Invalid request.", 400);
    }

    let action;
    try {
      action = await actionService.getAction({ userId, actionId: id });
    } catch (error) {
      return apiErrorFrom(error);
    }

    // The action's provider must still be connected. This is a cheap check and
    // keeps a revoked grant from burning the one-shot PENDING → EXECUTING
    // transition.
    if (action.provider === "gmail" || action.provider === "outlook") {
      const providers = await connectedMailProviders(userId);
      const required = action.provider === "gmail" ? "google" : "microsoft";
      if (!providers.includes(required)) {
        return apiError(
          "forbidden",
          action.provider === "gmail"
            ? "Reconnect your Google account before confirming this action."
            : "Reconnect your Outlook account before confirming this action.",
          403,
        );
      }
    }

    const ctx = await buildAgentContext({
      userId,
      conversationId: action.conversationId,
      requestId: randomUUID(),
    });
    const executor = createRegistryActionExecutor({
      registry: createDefaultToolRegistry(),
      ctx,
    });

    const emit = createLoggingEventSink("agent/actions");
    emit({
      type: "ACTION_CONFIRMED",
      actionId: action.id,
      toolName: action.toolName,
      userId,
    });
    const startedAt = Date.now();

    try {
      const result = await actionService.confirmAction({
        userId,
        actionId: id,
        executor,
        ...(parsed.data.args ? { args: parsed.data.args } : {}),
      });
      emit({
        type: "ACTION_SUCCEEDED",
        actionId: action.id,
        toolName: action.toolName,
        ms: Date.now() - startedAt,
      });
      return ok({
        action: toActionDto(result.action),
        result: result.result,
        executed: result.executed,
      });
    } catch (error) {
      const safe = toSafeError(error);
      emit({
        type: "ACTION_FAILED",
        actionId: action.id,
        toolName: action.toolName,
        code: safe.code,
      });
      return apiErrorFrom(error);
    }
  },
);
