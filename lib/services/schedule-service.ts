import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/agent/errors";
import { db, pool } from "@/lib/db";
import { pendingActions, scheduledActions } from "@/lib/db/schema";
import { JOB_KIND_SCHEDULED_EMAIL } from "@/lib/email-operator/job-kinds";
import { enqueueJob } from "@/lib/queue/queue";
import { sendService, type SendService } from "@/lib/services/send-service";

/**
 * ScheduleService — confirmed sends that fire later.
 *
 * A scheduled send is still a *confirmed* side effect. The model proposes it,
 * the permission engine defers it to a `pending_action`, and only the user's
 * confirmation runs the `schedule_email` tool, which lands here. This service
 * creates one `scheduled_actions` row and enqueues a `job_queue` job with
 * `runAfter`; no Redis, no in-process timers.
 *
 * At fire time `processScheduledAction` runs the send through the same
 * `SendService` and the same server-derived idempotency key as an immediate
 * send. A double-fired job, a retried job and a replayed confirmation therefore
 * collapse to one delivered message via `send_ledger`.
 */

export const MIN_SCHEDULE_LEAD_MS = 30 * 1000;
export const MAX_SCHEDULE_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;
export const MAX_SCHEDULED_LIST = 50;

export type ScheduledAction = typeof scheduledActions.$inferSelect;

export interface ScheduleEmailInput {
  userId: string;
  /** The confirmed pending action this schedule belongs to. */
  pendingActionId: string;
  /** When the message should go out. */
  runAfter: Date;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body: string;
}

export interface ScheduleEmailResult {
  scheduledActionId: string;
  runAfter: string;
  /** True when an existing schedule for this action was returned. */
  existing: boolean;
}

export interface ProcessScheduledResult {
  /** False when the row was already claimed/done (idempotent no-op). */
  processed: boolean;
  deduped: boolean;
}

export class ScheduleService {
  constructor(private readonly sender: SendService = sendService) {}

  /**
   * Persist a scheduled send and enqueue its job. Repeating the call for the
   * same pending action returns the existing schedule rather than creating a
   * second one.
   */
  async scheduleEmail(
    input: ScheduleEmailInput,
    now: Date = new Date(),
  ): Promise<ScheduleEmailResult> {
    if (!input.userId) throw new AuthenticationError();
    if (!input.pendingActionId) {
      throw new ValidationError(
        "A scheduled send can only be created from a confirmed action.",
      );
    }

    const runAfter = input.runAfter;
    if (!(runAfter instanceof Date) || Number.isNaN(runAfter.getTime())) {
      throw new ValidationError("sendAt must be a valid date and time.");
    }
    const lead = runAfter.getTime() - now.getTime();
    if (lead < MIN_SCHEDULE_LEAD_MS) {
      throw new ValidationError(
        "Choose a time at least a minute in the future.",
      );
    }
    if (lead > MAX_SCHEDULE_HORIZON_MS) {
      throw new ValidationError("A send can be scheduled at most a year ahead.");
    }

    const existing = await this.findByPendingAction(
      input.userId,
      input.pendingActionId,
    );
    if (existing) {
      return {
        scheduledActionId: existing.id,
        runAfter: existing.runAfter.toISOString(),
        existing: true,
      };
    }

    const id = nanoid();
    const inserted = await db
      .insert(scheduledActions)
      .values({
        id,
        userId: input.userId,
        pendingActionId: input.pendingActionId,
        runAfter,
        status: "pending",
      })
      .returning();

    const row = inserted[0]!;

    // `sourceEventId` dedupes event→job on the unique `(user_id, source_event_id)`
    // constraint, so an at-least-once enqueue cannot create two jobs.
    await enqueueJob(pool, input.userId, {
      kind: JOB_KIND_SCHEDULED_EMAIL,
      laneKey: `scheduled:${id}`,
      payload: { scheduledActionId: id },
      runAfter,
      sourceEventId: `scheduled:${id}`,
    });

    return {
      scheduledActionId: row.id,
      runAfter: row.runAfter.toISOString(),
      existing: false,
    };
  }

  /** Owner-scoped read of one scheduled action. */
  async getScheduledAction(input: {
    userId: string;
    scheduledActionId: string;
  }): Promise<ScheduledAction> {
    if (!input.userId) throw new AuthenticationError();
    const rows = await db
      .select()
      .from(scheduledActions)
      .where(
        and(
          eq(scheduledActions.id, input.scheduledActionId),
          eq(scheduledActions.userId, input.userId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError("That scheduled send was not found.");
    return row;
  }

  async listScheduledActions(input: {
    userId: string;
    limit?: number;
  }): Promise<ScheduledAction[]> {
    if (!input.userId) throw new AuthenticationError();
    const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_SCHEDULED_LIST);
    return db
      .select()
      .from(scheduledActions)
      .where(eq(scheduledActions.userId, input.userId))
      .orderBy(desc(scheduledActions.runAfter))
      .limit(limit);
  }

  /**
   * Execute one due schedule. The `pending → processing` claim is the same
   * guarded conditional UPDATE pattern the confirmation state machine uses: a
   * re-fired job loses the claim and does nothing.
   */
  async processScheduledAction(input: {
    scheduledActionId: string;
    now?: Date;
  }): Promise<ProcessScheduledResult> {
    const claimed = await db
      .update(scheduledActions)
      .set({ status: "processing" })
      .where(
        and(
          eq(scheduledActions.id, input.scheduledActionId),
          eq(scheduledActions.status, "pending"),
        ),
      )
      .returning();

    const row = claimed[0];
    if (!row) return { processed: false, deduped: true };

    try {
      const action = await this.loadPendingAction(row.userId, row.pendingActionId);
      if (action.toolName !== "schedule_email") {
        throw new ConflictError("This schedule is not a scheduled send.");
      }

      const args = action.arguments as {
        to?: unknown;
        cc?: unknown;
        bcc?: unknown;
        subject?: unknown;
        body?: unknown;
      };

      const result = await this.sender.sendMessage({
        userId: row.userId,
        // The action's own server-derived key: a replayed/duplicated execution
        // hits the ledger's unique constraint instead of sending twice.
        idempotencyKey: action.idempotencyKey,
        to: asStringList(args.to),
        ...(asStringList(args.cc).length ? { cc: asStringList(args.cc) } : {}),
        ...(asStringList(args.bcc).length ? { bcc: asStringList(args.bcc) } : {}),
        ...(typeof args.subject === "string" ? { subject: args.subject } : {}),
        body: typeof args.body === "string" ? args.body : "",
      });

      await db
        .update(scheduledActions)
        .set({ status: "done", lastError: null })
        .where(eq(scheduledActions.id, row.id));

      return { processed: true, deduped: result.deduped };
    } catch (error) {
      // Return the row to `pending` so the queue's retry can reclaim it; the
      // ledger is the final guard against a duplicate delivery.
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(scheduledActions)
        .set({
          status: "pending",
          attempts: row.attempts + 1,
          lastError: message.split("\n", 1)[0]!.slice(0, 300),
        })
        .where(eq(scheduledActions.id, row.id));
      throw error;
    }
  }

  private async findByPendingAction(
    userId: string,
    pendingActionId: string,
  ): Promise<ScheduledAction | undefined> {
    const rows = await db
      .select()
      .from(scheduledActions)
      .where(
        and(
          eq(scheduledActions.userId, userId),
          eq(scheduledActions.pendingActionId, pendingActionId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  private async loadPendingAction(userId: string, actionId: string) {
    const rows = await db
      .select()
      .from(pendingActions)
      .where(
        and(eq(pendingActions.id, actionId), eq(pendingActions.userId, userId)),
      )
      .limit(1);
    const action = rows[0];
    if (!action) throw new NotFoundError("The scheduled action was not found.");
    return action;
  }
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export const scheduleService = new ScheduleService();
