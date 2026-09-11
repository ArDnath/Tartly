import "server-only";

import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { canonicalize, hashArguments } from "@/lib/agent/action-hash";
import { deriveActionIdempotencyKey } from "@/lib/ai/idempotency";
import { AppError, ConflictError, NotFoundError, toSafeError, ValidationError } from "@/lib/agent/errors";
import { db } from "@/lib/db";
import {
  pendingActions,
  type PendingActionStatus,
} from "@/lib/db/schema";

/**
 * ActionService — the confirmation state machine.
 *
 * This is the single place a side effect can be authorised. The model never
 * calls it directly; it only *proposes* an action, which is persisted here as
 * `PENDING`. Execution happens exclusively through `confirmAction`, whose
 * `PENDING → EXECUTING` transition is a guarded conditional UPDATE so two
 * clicks (or two tabs) cannot execute twice.
 *
 * The service is storage-owned but integration-agnostic: the caller supplies
 * the executor. That keeps `lib/services` free of any dependency on the agent
 * tool registry while still reusing the tool's real implementation.
 */

export const PENDING_ACTION_TTL_MS = 30 * 60 * 1000;
export const MAX_PENDING_ACTIONS = 20;
export const MAX_ACTION_LIST = 50;

const PENDING_ACTION_STATUSES: readonly PendingActionStatus[] = [
  "PENDING",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
];

/** Narrow an untrusted query value to a known action status. */
export function isPendingActionStatus(value: string): value is PendingActionStatus {
  return (PENDING_ACTION_STATUSES as readonly string[]).includes(value);
}

export type PendingAction = typeof pendingActions.$inferSelect;

export type ActionExecutor = (input: {
  action: PendingAction;
  args: Record<string, unknown>;
}) => Promise<unknown>;

export interface ConfirmActionResult {
  action: PendingAction;
  result: unknown;
  /** False when the action had already succeeded (idempotent replay). */
  executed: boolean;
}

function statusMessage(status: PendingActionStatus): string {
  switch (status) {
    case "EXECUTING":
      return "This action is already being processed.";
    case "CANCELLED":
      return "This action was cancelled.";
    case "EXPIRED":
      return "This action has expired. Ask the assistant to prepare it again.";
    case "FAILED":
      return "This action already ran and failed. Ask the assistant to prepare it again.";
    default:
      return "This action can no longer be confirmed.";
  }
}

function toJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

export interface CreatePendingActionInput {
  userId: string;
  conversationId: string;
  toolName: string;
  args: Record<string, unknown>;
  provider?: string;
  messageId?: string | null;
  ttlMs?: number;
  now?: Date;
}

export class ActionService {
  async createPendingAction(
    input: CreatePendingActionInput,
  ): Promise<PendingAction> {
    if (!input.userId) throw new ValidationError("An action needs a user.");
    if (!input.conversationId) {
      throw new ValidationError("An action needs a conversation.");
    }

    const now = input.now ?? new Date();
    const provider = input.provider?.trim() || "gmail";
    const args = input.args ?? {};
    const argumentsHash = hashArguments(args);

    const outstanding = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pendingActions)
      .where(
        and(
          eq(pendingActions.userId, input.userId),
          eq(pendingActions.status, "PENDING"),
          gt(pendingActions.expiresAt, now),
        ),
      );
    if ((outstanding[0]?.count ?? 0) >= MAX_PENDING_ACTIONS) {
      throw new ValidationError(
        "There are too many actions waiting for confirmation. Resolve or cancel some first.",
      );
    }

    const id = nanoid();
    const expiresAt = new Date(now.getTime() + (input.ttlMs ?? PENDING_ACTION_TTL_MS));
    // Server-derived, never client-supplied: a caller cannot force or collapse
    // sends by choosing a key.
    const idempotencyKey = deriveActionIdempotencyKey({
      userId: input.userId,
      actionId: id,
      provider,
      argumentsHash,
    });

    const inserted = await db
      .insert(pendingActions)
      .values({
        id,
        userId: input.userId,
        conversationId: input.conversationId,
        messageId: input.messageId ?? null,
        toolName: input.toolName,
        arguments: args,
        argumentsHash,
        provider,
        status: "PENDING",
        idempotencyKey,
        expiresAt,
      })
      .returning();

    return inserted[0]!;
  }

  /** Owner-scoped read. Never returns another user's action. */
  async getAction(input: {
    userId: string;
    actionId: string;
  }): Promise<PendingAction> {
    if (!input.userId) throw new ValidationError("An action needs a user.");
    const rows = await db
      .select()
      .from(pendingActions)
      .where(
        and(
          eq(pendingActions.id, input.actionId),
          eq(pendingActions.userId, input.userId),
        ),
      )
      .limit(1);
    const action = rows[0];
    if (!action) throw new NotFoundError("That action could not be found.");
    return action;
  }

  async listActions(input: {
    userId: string;
    status?: PendingActionStatus;
    limit?: number;
  }): Promise<PendingAction[]> {
    if (!input.userId) throw new ValidationError("An action needs a user.");
    const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_ACTION_LIST);
    const conditions = [eq(pendingActions.userId, input.userId)];
    if (input.status) conditions.push(eq(pendingActions.status, input.status));
    return db
      .select()
      .from(pendingActions)
      .where(and(...conditions))
      .orderBy(desc(pendingActions.createdAt))
      .limit(limit);
  }

  /**
   * Owner-scoped "what changed since" used by the realtime stream. `updatedAt`
   * moves on every state transition, so a client that remembers the last cursor
   * can reconcile confirmed/cancelled cards without polling each one.
   */
  async listUpdatedSince(input: {
    userId: string;
    since: Date;
    limit?: number;
  }): Promise<PendingAction[]> {
    if (!input.userId) throw new ValidationError("An action needs a user.");
    const limit = Math.min(Math.max(input.limit ?? 50, 1), MAX_ACTION_LIST);
    return db
      .select()
      .from(pendingActions)
      .where(
        and(
          eq(pendingActions.userId, input.userId),
          gt(pendingActions.updatedAt, input.since),
        ),
      )
      .orderBy(asc(pendingActions.updatedAt))
      .limit(limit);
  }

  /**
   * Confirm and execute. Guarantees:
   *  - the arguments the action was created with are the arguments executed
   *    (a caller-supplied `args` payload must hash to the stored hash);
   *  - exactly one concurrent caller wins the `PENDING → EXECUTING` race;
   *  - a replay after success returns the prior result without re-executing.
   */
  async confirmAction(input: {
    userId: string;
    actionId: string;
    executor: ActionExecutor;
    /** Optional restatement of the arguments; verified against the hash. */
    args?: Record<string, unknown>;
    now?: Date;
  }): Promise<ConfirmActionResult> {
    const now = input.now ?? new Date();
    const existing = await this.getAction(input);

    if (existing.status === "SUCCEEDED") {
      return { action: existing, result: existing.result ?? null, executed: false };
    }
    if (existing.status !== "PENDING") {
      throw new ConflictError(statusMessage(existing.status));
    }
    if (existing.expiresAt.getTime() <= now.getTime()) {
      await this.markExpired(input.userId, existing.id);
      throw new ConflictError(statusMessage("EXPIRED"));
    }
    if (
      input.args !== undefined &&
      hashArguments(input.args) !== existing.argumentsHash
    ) {
      throw new ValidationError(
        "These action details no longer match the confirmed version.",
      );
    }

    // The race is decided here: only one PENDING row can move to EXECUTING.
    const claimed = await db
      .update(pendingActions)
      .set({ status: "EXECUTING", confirmedAt: now, updatedAt: now })
      .where(
        and(
          eq(pendingActions.id, existing.id),
          eq(pendingActions.userId, input.userId),
          eq(pendingActions.status, "PENDING"),
          gt(pendingActions.expiresAt, now),
        ),
      )
      .returning();

    const executing = claimed[0];
    if (!executing) {
      const current = await this.getAction(input);
      if (current.status === "SUCCEEDED") {
        return { action: current, result: current.result ?? null, executed: false };
      }
      throw new ConflictError(statusMessage(current.status));
    }

    try {
      const result = await input.executor({
        action: executing,
        args: executing.arguments,
      });
      const finished = await db
        .update(pendingActions)
        .set({
          status: "SUCCEEDED",
          result: toJsonRecord(result),
          executedAt: new Date(),
          updatedAt: new Date(),
          lastError: null,
        })
        .where(eq(pendingActions.id, executing.id))
        .returning();
      return { action: finished[0] ?? executing, result, executed: true };
    } catch (error) {
      const safe = toSafeError(error);
      await db
        .update(pendingActions)
        .set({
          status: "FAILED",
          lastError: safe.message.slice(0, 500),
          executedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(pendingActions.id, executing.id));
      if (error instanceof AppError) throw error;
      throw new AppError("The action failed to complete.", {
        code: "external_service",
        httpStatus: 502,
        expose: true,
        cause: error,
      });
    }
  }

  /** Cancel a pending action. Idempotent: cancelling twice is not an error. */
  async cancelAction(input: {
    userId: string;
    actionId: string;
    now?: Date;
  }): Promise<PendingAction> {
    const now = input.now ?? new Date();
    const cancelled = await db
      .update(pendingActions)
      .set({ status: "CANCELLED", updatedAt: now })
      .where(
        and(
          eq(pendingActions.id, input.actionId),
          eq(pendingActions.userId, input.userId),
          eq(pendingActions.status, "PENDING"),
          gt(pendingActions.expiresAt, now),
        ),
      )
      .returning();

    if (cancelled[0]) return cancelled[0];

    const current = await this.getAction(input);
    if (current.status === "CANCELLED") return current;
    throw new ConflictError(statusMessage(current.status));
  }

  /** Lazily move expired pending actions out of the way. Bounded batch. */
  async expireStale(input: { now?: Date; limit?: number } = {}): Promise<number> {
    const now = input.now ?? new Date();
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const stale = await db
      .select({ id: pendingActions.id })
      .from(pendingActions)
      .where(
        and(
          eq(pendingActions.status, "PENDING"),
          lte(pendingActions.expiresAt, now),
        ),
      )
      .limit(limit);
    if (stale.length === 0) return 0;
    await db
      .update(pendingActions)
      .set({ status: "EXPIRED", updatedAt: now })
      .where(inArray(pendingActions.id, stale.map((row) => row.id)));
    return stale.length;
  }

  private async markExpired(userId: string, actionId: string): Promise<void> {
    await db
      .update(pendingActions)
      .set({ status: "EXPIRED", updatedAt: new Date() })
      .where(
        and(
          eq(pendingActions.id, actionId),
          eq(pendingActions.userId, userId),
          eq(pendingActions.status, "PENDING"),
        ),
      );
  }
}

export const actionService = new ActionService();

/** JSON-safe shape handed to the client. */
export function toActionDto(action: PendingAction) {
  return {
    id: action.id,
    toolName: action.toolName,
    arguments: action.arguments,
    argumentsHash: action.argumentsHash,
    provider: action.provider,
    status: action.status,
    conversationId: action.conversationId,
    expiresAt: action.expiresAt.toISOString(),
    confirmedAt: action.confirmedAt?.toISOString() ?? null,
    executedAt: action.executedAt?.toISOString() ?? null,
    result: action.result ?? null,
    createdAt: action.createdAt.toISOString(),
  };
}

// `canonicalize` is re-exported for callers that need the exact hash input.
export { canonicalize };
