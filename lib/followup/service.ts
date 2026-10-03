import "server-only";

import { nanoid } from "nanoid";

import { DEFAULT_CALENDAR_SETTINGS, getCalendarSettings } from "@/lib/calendar/settings";
import { addUtcDays } from "@/lib/calendar/tz";
import {
  buildPage,
  decodeCursor,
  DEFAULT_PAGE_LIMIT,
  type CursorValues,
  type PaginationMeta,
} from "@/lib/api/pagination";
import { pool } from "@/lib/db";
import { nextDeliverableTime, isUnreachableAddress } from "@/lib/followup/rules";
import { generateFollowupDraft } from "@/lib/ai/features/followup-draft";
import { JOB_KIND_FOLLOWUP } from "@/lib/email-operator/job-kinds";
import { enqueueJob } from "@/lib/queue/queue";
import { draftRepository } from "@/lib/repositories/drafts";
import {
  followupEnrollmentRepository,
  type FollowupEnrollment,
  type FollowupWithSubject,
} from "@/lib/repositories/followup-enrollments";
import { messageRepository } from "@/lib/repositories/messages";

export type EnrollmentRow = FollowupEnrollment;

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
  const message = await messageRepository.latestInboundByThreadId(threadId);
  return message?.fromAddr ?? null;
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
  const existing = await followupEnrollmentRepository.findActiveByThread(threadId);
  if (existing) return existing;

  const recipient = await latestInboundSender(threadId);
  if (isUnreachableAddress(recipient)) return null;

  const window = await deliverableWindow(userId);
  const nextEvalAt = nextDeliverableTime(addUtcDays(now, afterDays), window);

  return followupEnrollmentRepository.insert({
    id: nanoid(),
    userId,
    threadId,
    stage: "waiting",
    attempts: 0,
    maxAttempts,
    nextEvalAt,
    status: "active",
  });
}

/** Stops every active enrollment for a thread — called when they reply. */
export async function reactivityOnInbound(threadId: string): Promise<number> {
  return followupEnrollmentRepository.stopActiveByThread({
    threadId,
    reason: "replied",
    now: new Date(),
  });
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
  return followupEnrollmentRepository.stopOwned({
    userId,
    enrollmentId,
    reason,
    now: new Date(),
  });
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
  return followupEnrollmentRepository.setPaused({
    userId,
    enrollmentId,
    paused,
    now: new Date(),
  });
}

/**
 * Push the next evaluation out by `days` (clamped to the working window).
 * "Tomorrow" on a briefing card is a one-day snooze; the enrollment stays
 * active, so the cadence continues.
 */
export async function snoozeEnrollment({
  userId,
  enrollmentId,
  days = 1,
  now = new Date(),
}: {
  userId: string;
  enrollmentId: string;
  days?: number;
  now?: Date;
}): Promise<EnrollmentRow | null> {
  const enrollment = await followupEnrollmentRepository.findByIdForUser(
    userId,
    enrollmentId,
  );
  if (!enrollment) return null;

  const boundedDays = Math.min(Math.max(Math.trunc(days), 1), 30);
  const window = await deliverableWindow(userId);
  const next = nextDeliverableTime(addUtcDays(now, boundedDays), window);

  return followupEnrollmentRepository.updateById(enrollment.id, {
    status: "active",
    nextEvalAt: next,
    updatedAt: now,
  });
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
  const rows = await followupEnrollmentRepository.listForUserWithSubject({
    userId,
    limit: MAX_FOLLOWUP_LIMIT,
  });
  return mapFollowupRows(rows);
}

/** Cursor scope tag: keeps a follow-ups cursor from being replayed elsewhere. */
const FOLLOWUP_CURSOR_SCOPE = "followups";
const MAX_FOLLOWUP_LIMIT = 100;

function followupCursorOf(row: FollowupWithSubject): CursorValues {
  return { c: row.enrollment.createdAt.toISOString(), id: row.enrollment.id };
}

function decodeFollowupCursor(
  cursor: string | null | undefined,
): { createdAt: Date; id: string } | undefined {
  const values = decodeCursor(cursor, FOLLOWUP_CURSOR_SCOPE, ["c", "id"]);
  if (!values) return undefined;
  const { c, id } = values;
  if (typeof id !== "string" || id.length === 0) return undefined;
  if (typeof c !== "string") return undefined;
  const createdAt = new Date(c);
  if (Number.isNaN(createdAt.getTime())) return undefined;
  return { createdAt, id };
}

/**
 * One cursor page of follow-ups, newest first (Phase C5). Over-fetches by one
 * to compute `has_more`, so a page is always exactly `limit` rows.
 */
export async function listFollowupsPage({
  userId,
  cursor,
  limit = DEFAULT_PAGE_LIMIT,
}: {
  userId: string;
  cursor?: string | null;
  limit?: number;
}): Promise<{ followups: FollowupListItem[]; pagination: PaginationMeta }> {
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), MAX_FOLLOWUP_LIMIT);
  const after = decodeFollowupCursor(cursor);
  const rows = await followupEnrollmentRepository.listForUserWithSubject({
    userId,
    ...(after ? { after } : {}),
    limit: bounded + 1,
  });
  const { page, pagination } = buildPage({
    rows,
    limit: bounded,
    scope: FOLLOWUP_CURSOR_SCOPE,
    cursorOf: followupCursorOf,
  });
  return { followups: mapFollowupRows(page), pagination };
}

function mapFollowupRows(rows: FollowupWithSubject[]): FollowupListItem[] {
  return rows.map(({ enrollment, subject }) => ({
    id: enrollment.id,
    threadId: enrollment.threadId,
    subject,
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

/**
 * Processes one due enrollment: drafts a nudge, advances the attempt count and
 * schedules the next one (or completes). Never sends directly — the nudge is a
 * draft the user approves.
 */
export async function processFollowupEnrollment(
  enrollmentId: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ status: string; attempts: number } | null> {
  const enrollment = await followupEnrollmentRepository.findById(enrollmentId);
  if (!enrollment) return null;
  if (enrollment.status !== "active") {
    return { status: enrollment.status, attempts: enrollment.attempts };
  }

  const recipient = await latestInboundSender(enrollment.threadId);
  if (isUnreachableAddress(recipient)) {
    await followupEnrollmentRepository.updateById(enrollment.id, {
      status: "stopped",
      stopReason: "unreachable",
    });
    return { status: "stopped", attempts: enrollment.attempts };
  }

  const attempts = enrollment.attempts + 1;
  const { body, version } = await generateFollowupDraft({
    userId: enrollment.userId,
    threadId: enrollment.threadId,
  });

  const pending = await draftRepository.findAnyPendingByThread(enrollment.threadId);

  if (pending) {
    await draftRepository.updateBodyById({
      draftId: pending.id,
      body,
      pipelineVersion: version,
    });
  } else {
    await draftRepository.insert({
      id: nanoid(),
      userId: enrollment.userId,
      threadId: enrollment.threadId,
      body,
      pipelineVersion: version,
      status: "pending",
    });
  }

  if (attempts >= enrollment.maxAttempts) {
    await followupEnrollmentRepository.updateById(enrollment.id, {
      status: "completed",
      attempts,
      nextEvalAt: null,
      updatedAt: now,
    });
    return { status: "completed", attempts };
  }

  const window = await deliverableWindow(enrollment.userId);
  const nextEvalAt = nextDeliverableTime(addUtcDays(now, DEFAULT_AFTER_DAYS), window);

  await followupEnrollmentRepository.updateById(enrollment.id, {
    attempts,
    nextEvalAt,
    updatedAt: now,
  });

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
  const due = await followupEnrollmentRepository.listDueActive({ now, limit });

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
  await followupEnrollmentRepository.deleteForUser(userId);
}
