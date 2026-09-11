import "server-only";

import { and, desc, eq, lte } from "drizzle-orm";
import { nanoid } from "nanoid";

import { DEFAULT_CALENDAR_SETTINGS, getCalendarSettings } from "@/lib/calendar/settings";
import { addUtcDays } from "@/lib/calendar/tz";
import { db, pool } from "@/lib/db";
import {
  drafts,
  followupEnrollments,
  messages,
  threads,
} from "@/lib/db/schema";
import { nextDeliverableTime, isUnreachableAddress } from "@/lib/followup/rules";
import { JOB_KIND_FOLLOWUP } from "@/lib/email-operator/job-kinds";
import { enqueueJob } from "@/lib/queue/queue";

export type EnrollmentRow = typeof followupEnrollments.$inferSelect;

const DEFAULT_AFTER_DAYS = 3;
const DEFAULT_MAX_ATTEMPTS = 3;

async function deliverableWindow(userId: string) {
  const settings = (await getCalendarSettings(userId)) ?? DEFAULT_CALENDAR_SETTINGS;
  return {
    timeZone: settings.timezone,
    workDays: settings.workDays,
    workStartHour: settings.workStartHour,
    quietEndHour: settings.workEndHour,
  };
}

async function latestInboundSender(threadId: string): Promise<string | null> {
  const rows = await db
    .select({ fromAddr: messages.fromAddr })
    .from(messages)
    .where(and(eq(messages.threadId, threadId), eq(messages.direction, "inbound")))
    .orderBy(desc(messages.sentAt))
    .limit(1);
  return rows[0]?.fromAddr ?? null;
}

/**
 * Enrolls a thread in a follow-up cadence after we replied. Idempotent: a thread
 * with an active enrollment is returned as-is, and unreachable recipients are
 * never enrolled.
 */
export async function enrollThread({
  userId,
  threadId,
  afterDays = DEFAULT_AFTER_DAYS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  now = new Date(),
}: {
  userId: string;
  threadId: string;
  afterDays?: number;
  maxAttempts?: number;
  now?: Date;
}): Promise<EnrollmentRow | null> {
  const existing = await db
    .select()
    .from(followupEnrollments)
    .where(
      and(
        eq(followupEnrollments.threadId, threadId),
        eq(followupEnrollments.status, "active"),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0];

  const recipient = await latestInboundSender(threadId);
  if (isUnreachableAddress(recipient)) return null;

  const window = await deliverableWindow(userId);
  const nextEvalAt = nextDeliverableTime(addUtcDays(now, afterDays), window);

  const inserted = await db
    .insert(followupEnrollments)
    .values({
      id: nanoid(),
      userId,
      threadId,
      stage: "waiting",
      attempts: 0,
      maxAttempts,
      nextEvalAt,
      status: "active",
    })
    .returning();

  return inserted[0];
}

/** Stops every active enrollment for a thread — called when they reply. */
export async function reactivityOnInbound(threadId: string): Promise<number> {
  const updated = await db
    .update(followupEnrollments)
    .set({ status: "stopped", stopReason: "replied", updatedAt: new Date() })
    .where(
      and(
        eq(followupEnrollments.threadId, threadId),
        eq(followupEnrollments.status, "active"),
      ),
    )
    .returning({ id: followupEnrollments.id });
  return updated.length;
}

export async function stopEnrollment({
  userId,
  enrollmentId,
  reason = "manual",
}: {
  userId: string;
  enrollmentId: string;
  reason?: string;
}): Promise<boolean> {
  const updated = await db
    .update(followupEnrollments)
    .set({ status: "stopped", stopReason: reason, updatedAt: new Date() })
    .where(
      and(
        eq(followupEnrollments.id, enrollmentId),
        eq(followupEnrollments.userId, userId),
      ),
    )
    .returning({ id: followupEnrollments.id });
  return updated.length > 0;
}

export async function pauseEnrollment({
  userId,
  enrollmentId,
  paused,
}: {
  userId: string;
  enrollmentId: string;
  paused: boolean;
}): Promise<EnrollmentRow | null> {
  const updated = await db
    .update(followupEnrollments)
    .set({
      status: paused ? "paused" : "active",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(followupEnrollments.id, enrollmentId),
        eq(followupEnrollments.userId, userId),
      ),
    )
    .returning();
  return updated[0] ?? null;
}

export type FollowupListItem = {
  id: string;
  threadId: string;
  subject: string | null;
  status: string;
  stage: string;
  attempts: number;
  maxAttempts: number;
  nextEvalAt: string | null;
  stopReason: string | null;
};

export async function listFollowups(userId: string): Promise<FollowupListItem[]> {
  const rows = await db
    .select({
      enrollment: followupEnrollments,
      thread: { id: threads.id, subject: threads.subject },
    })
    .from(followupEnrollments)
    .leftJoin(threads, eq(threads.id, followupEnrollments.threadId))
    .where(eq(followupEnrollments.userId, userId))
    .orderBy(desc(followupEnrollments.createdAt))
    .limit(100);

  return rows.map(({ enrollment, thread }) => ({
    id: enrollment.id,
    threadId: enrollment.threadId,
    subject: thread?.subject ?? null,
    status: enrollment.status,
    stage: enrollment.stage,
    attempts: enrollment.attempts,
    maxAttempts: enrollment.maxAttempts,
    nextEvalAt: enrollment.nextEvalAt
      ? enrollment.nextEvalAt.toISOString()
      : null,
    stopReason: enrollment.stopReason,
  }));
}

function buildNudgeBody(subject: string | null): string {
  return [
    "Just following up on my previous note.",
    subject ? `Re: ${subject}` : "",
    "",
    "Did you get a chance to look? Happy to jump on a quick call if that's easier.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Processes one due enrollment: drafts a nudge, advances the attempt count and
 * schedules the next one (or completes). Never sends directly — the nudge is a
 * draft the user approves.
 */
export async function processFollowupEnrollment(
  enrollmentId: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ status: string; attempts: number } | null> {
  const rows = await db
    .select()
    .from(followupEnrollments)
    .where(eq(followupEnrollments.id, enrollmentId))
    .limit(1);
  const enrollment = rows[0];
  if (!enrollment) return null;
  if (enrollment.status !== "active") {
    return { status: enrollment.status, attempts: enrollment.attempts };
  }

  const recipient = await latestInboundSender(enrollment.threadId);
  if (isUnreachableAddress(recipient)) {
    await db
      .update(followupEnrollments)
      .set({ status: "stopped", stopReason: "unreachable" })
      .where(eq(followupEnrollments.id, enrollment.id));
    return { status: "stopped", attempts: enrollment.attempts };
  }

  const threadRows = await db
    .select({ subject: threads.subject })
    .from(threads)
    .where(eq(threads.id, enrollment.threadId))
    .limit(1);
  const subject = threadRows[0]?.subject ?? null;

  const attempts = enrollment.attempts + 1;
  const body = buildNudgeBody(subject);

  const pending = await db
    .select({ id: drafts.id })
    .from(drafts)
    .where(
      and(eq(drafts.threadId, enrollment.threadId), eq(drafts.status, "pending")),
    )
    .limit(1);

  if (pending[0]) {
    await db.update(drafts).set({ body }).where(eq(drafts.id, pending[0].id));
  } else {
    await db.insert(drafts).values({
      id: nanoid(),
      userId: enrollment.userId,
      threadId: enrollment.threadId,
      body,
      status: "pending",
    });
  }

  if (attempts >= enrollment.maxAttempts) {
    await db
      .update(followupEnrollments)
      .set({
        status: "completed",
        attempts,
        nextEvalAt: null,
        updatedAt: now,
      })
      .where(eq(followupEnrollments.id, enrollment.id));
    return { status: "completed", attempts };
  }

  const window = await deliverableWindow(enrollment.userId);
  const nextEvalAt = nextDeliverableTime(addUtcDays(now, DEFAULT_AFTER_DAYS), window);

  await db
    .update(followupEnrollments)
    .set({ attempts, nextEvalAt, updatedAt: now })
    .where(eq(followupEnrollments.id, enrollment.id));

  return { status: "active", attempts };
}

/**
 * Enqueues a `followup` job for every due active enrollment. The unique
 * `sourceEventId` (per attempt) makes a double-fired cron harmless.
 */
export async function enqueueDueFollowups({
  now = new Date(),
  limit = 25,
}: { now?: Date; limit?: number } = {}): Promise<number> {
  const due = await db
    .select()
    .from(followupEnrollments)
    .where(
      and(
        eq(followupEnrollments.status, "active"),
        lte(followupEnrollments.nextEvalAt, now),
      ),
    )
    .orderBy(followupEnrollments.nextEvalAt)
    .limit(limit);

  let enqueued = 0;
  for (const enrollment of due) {
    const { deduped } = await enqueueJob(pool, enrollment.userId, {
      kind: JOB_KIND_FOLLOWUP,
      laneKey: `thread:${enrollment.threadId}`,
      payload: { enrollmentId: enrollment.id },
      sourceEventId: `followup:${enrollment.id}:${enrollment.attempts}`,
    });
    if (!deduped) enqueued += 1;
  }
  return enqueued;
}

/** Used by tests/cleanup. */
export async function deleteEnrollmentsForUser(userId: string): Promise<void> {
  await db
    .delete(followupEnrollments)
    .where(eq(followupEnrollments.userId, userId));
}
