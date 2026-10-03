import "server-only";

import { nanoid } from "nanoid";

import { canonicalize, hashArguments } from "@/lib/agent/action-hash";
import { deriveActionIdempotencyKey } from "@/lib/ai/idempotency";
import { AppError, ConflictError, NotFoundError, toSafeError, ValidationError } from "@/lib/agent/errors";
import {
  buildPage,
  decodeCursor,
  type CursorValues,
  type PaginationMeta,
} from "@/lib/api/pagination";
import {
  PendingActionRepository,
  pendingActionRepository,
  type PendingAction,
  type PendingActionStatus,
} from "@/lib/repositories/pending-actions";

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
 * tool registry while still reusing the tool's real implementation. SQL lives
 * in `PendingActionRepository`.
 */

export const PENDING_ACTION_TTL_MS = 30 * 60 * 1000;
export const MAX_PENDING_ACTIONS = 20;
export const MAX_ACTION_LIST = 50;

/** Cursor scope tag: keeps an actions cursor from being replayed elsewhere. */
const ACTION_CURSOR_SCOPE = "agent-actions";

function decodeActionCursor(
  cursor: string | null | undefined,
): { createdAt: Date; id: string } | undefined {
  const values = decodeCursor(cursor, ACTION_CURSOR_SCOPE, ["c", "id"]);
  if (!values) return undefined;
  const { c, id } = values;
  if (typeof id !== "string" || id.length === 0) return undefined;
  if (typeof c !== "string") return undefined;
  const createdAt = new Date(c);
  if (Number.isNaN(createdAt.getTime())) return undefined;
  return { createdAt, id };
}

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

export type { PendingAction };

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
  constructor(
    private readonly actions: PendingActionRepository = pendingActionRepository,
  ) {}

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

    const outstanding = await this.actions.countOutstanding(input.userId, now);
    if (outstanding >= MAX_PENDING_ACTIONS) {
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

    return this.actions.insert({
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
    });
  }

  /** Owner-scoped read. Never returns another user's action. */
  async getAction(input: {
    userId: string;
    actionId: string;
  }): Promise<PendingAction> {
    if (!input.userId) throw new ValidationError("An action needs a user.");
    const action = await this.actions.findByIdForUser(
      input.userId,
      input.actionId,
    );
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
    return this.actions.listForUser({
      userId: input.userId,
      ...(input.status ? { status: input.status } : {}),
      limit,
    });
  }

  /**
   * One cursor page of the caller's actions, newest first (Phase C5). Owner
   * scoping is unchanged: the user id is part of every query.
   */
  async listActionsPage(input: {
    userId: string;
    status?: PendingActionStatus;
    cursor?: string | null;
    limit?: number;
  }): Promise<{ actions: PendingAction[]; pagination: PaginationMeta }> {
    if (!input.userId) throw new ValidationError("An action needs a user.");
    const limit = Math.min(
      Math.max(Math.trunc(input.limit ?? MAX_ACTION_LIST), 1),
      MAX_ACTION_LIST,
    );
    const after = decodeActionCursor(input.cursor);
    const rows = await this.actions.listForUser({
      userId: input.userId,
      ...(input.status ? { status: input.status } : {}),
      ...(after ? { after } : {}),
      limit: limit + 1,
    });
    const { page, pagination } = buildPage({
      rows,
      limit,
      scope: ACTION_CURSOR_SCOPE,
      cursorOf: (action): CursorValues => ({
        c: action.createdAt.toISOString(),
        id: action.id,
      }),
    });
    return { actions: page, pagination };
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
    return this.actions.listUpdatedSince({
      userId: input.userId,
      since: input.since,
      limit,
    });
  }

  /**
   * Batched form of {@link listUpdatedSince} for the shared realtime poller:
   * one query covers every connected user, so the DB poll rate tracks the
   * instance count, not the number of open tabs. The global limit is a safety
   * cap; per-user fairness is not guaranteed under one user's heavy churn.
   */
  async listUpdatedSinceMany(input: {
    userIds: string[];
    since: Date;
    limitPerUser?: number;
  }): Promise<PendingAction[]> {
    const userIds = [...new Set(input.userIds.filter(Boolean))];
    if (userIds.length === 0) return [];
    const perUser = Math.min(Math.max(input.limitPerUser ?? 50, 1), MAX_ACTION_LIST);
    const total = Math.min(perUser * userIds.length, 500);
    return this.actions.listUpdatedSinceMany({
      userIds,
      since: input.since,
      limit: total,
    });
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
    const executing = await this.actions.claimPending({
      userId: input.userId,
      actionId: existing.id,
      now,
    });

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
      const finished = await this.actions.markSucceeded({
        actionId: executing.id,
        result: toJsonRecord(result),
        now: new Date(),
      });
      return { action: finished ?? executing, result, executed: true };
    } catch (error) {
      const safe = toSafeError(error);
      await this.actions.markFailed({
        actionId: executing.id,
        lastError: safe.message.slice(0, 500),
        now: new Date(),
      });
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
    const cancelled = await this.actions.markCancelled({
      userId: input.userId,
      actionId: input.actionId,
      now,
    });

    if (cancelled) return cancelled;

    const current = await this.getAction(input);
    if (current.status === "CANCELLED") return current;
    throw new ConflictError(statusMessage(current.status));
  }

  /** Lazily move expired pending actions out of the way. Bounded batch. */
  async expireStale(input: { now?: Date; limit?: number } = {}): Promise<number> {
    const now = input.now ?? new Date();
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const stale = await this.actions.listExpiredIds({ now, limit });
    if (stale.length === 0) return 0;
    await this.actions.markExpiredByIds(stale, now);
    return stale.length;
  }

  private async markExpired(userId: string, actionId: string): Promise<void> {
    await this.actions.markExpiredOwned({
      userId,
      actionId,
      now: new Date(),
    });
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
