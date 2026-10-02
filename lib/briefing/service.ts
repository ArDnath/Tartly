import "server-only";

import { and, asc, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";

import {
  generateMeetingBrief,
  type MeetingBrief,
} from "@/lib/ai/features/meeting-brief";
import { db } from "@/lib/db";
import {
  commitments,
  drafts,
  followupEnrollments,
  meetings,
  messages,
  threads,
  user,
} from "@/lib/db/schema";
import { getCalendarSettings } from "@/lib/calendar/settings";
import { getZonedParts } from "@/lib/calendar/tz";
import { endOfLocalDay, getInboxCounts, listInbox } from "@/lib/inbox/service";
import type { InboxCounts } from "@/lib/inbox/service";
import { redis } from "@/lib/redis";

/**
 * Morning briefing composition.
 *
 * Deterministic and cheap: it reads what the inbox/follow-up/commitment/meeting
 * tables already hold and never blocks on a model (meeting briefs are cached by
 * `(event, attendees, day)`; the rest is plain SQL). Cached in Redis for ten
 * minutes so opening the briefing repeatedly is free, and it always works live
 * if the daily warm missed.
 */

export const BRIEFING_CACHE_TTL_SECONDS = 600;
export const BRIEFING_WINDOW_HOURS = 48;
const MAX_REPLIES = 6;
const MAX_FOLLOWUPS = 6;
const MAX_PROMISES = 6;
const MAX_MEETINGS = 5;

export type BriefingDraft = { id: string; body: string } | null;

export type BriefingReply = {
  threadId: string;
  from: string | null;
  fromName: string | null;
  subject: string | null;
  summary: string | null;
  draft: BriefingDraft;
  commitments: Array<{ id: string; direction: string; description: string }>;
};

export type BriefingFollowup = {
  enrollmentId: string;
  threadId: string;
  from: string | null;
  subject: string | null;
  dueAt: string | null;
  lastSentAt: string | null;
  draft: BriefingDraft;
};

export type BriefingPromise = {
  commitmentId: string;
  threadId: string | null;
  direction: string;
  description: string;
  dueAt: string | null;
  overdue: boolean;
  draft: BriefingDraft;
};

export type BriefingMeeting = {
  meetingId: string;
  subject: string | null;
  startAt: string | null;
  meetLink: string | null;
  brief: MeetingBrief | null;
};

/** The part of day, used to greet the user in their local time. */
export type BriefingDaypart = "morning" | "afternoon" | "evening" | "night";

/**
 * Map a local hour (0-23) to a daypart.
 * 05-11 morning · 12-16 afternoon · 17-21 evening · 22-04 night.
 */
export function daypartForHour(hour: number): BriefingDaypart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

export type Briefing = {
  generatedAt: string;
  greeting: { name: string; total: number; daypart: BriefingDaypart };
  counts: InboxCounts;
  replies: BriefingReply[];
  followups: BriefingFollowup[];
  promises: BriefingPromise[];
  meetings: BriefingMeeting[];
};

export function briefingCacheKey(userId: string): string {
  // v2: the greeting carries a daypart, so older cached payloads are invalid.
  return `briefing:v2:${userId}`;
}

/** Drop the cached briefing so the next read recomputes (after an action). */
export async function invalidateBriefing(userId: string): Promise<void> {
  try {
    await redis.del(briefingCacheKey(userId));
  } catch (error) {
    console.warn("[briefing] cache invalidation failed", error);
  }
}

async function latestPendingDraft(
  threadId: string,
): Promise<BriefingDraft> {
  const rows = await db
    .select({ id: drafts.id, body: drafts.body })
    .from(drafts)
    .where(
      and(
        eq(drafts.threadId, threadId),
        eq(drafts.status, "pending"),
        eq(drafts.suppressed, false),
      ),
    )
    .orderBy(desc(drafts.createdAt))
    .limit(1);
  return rows[0] ? { id: rows[0].id, body: rows[0].body } : null;
}

/**
 * Compose the briefing for a user. Every section is bounded; a failure in one
 * section never sinks the others because each is awaited independently with a
 * safe default.
 */
export async function buildBriefing(
  userId: string,
  now: Date = new Date(),
): Promise<Briefing> {
  const settings = await getCalendarSettings(userId);
  const timeZone = settings?.timezone ?? "UTC";
  const endOfDay = endOfLocalDay(now, timeZone);
  const windowEnd = new Date(
    now.getTime() + BRIEFING_WINDOW_HOURS * 60 * 60 * 1000,
  );

  const [userRows, counts, replyItems, followupRows, promiseRows, meetingRows] =
    await Promise.all([
      db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1),
      getInboxCounts(userId),
      listInbox({ userId, view: "needs_reply", limit: MAX_REPLIES }),
      db
        .select({
          enrollmentId: followupEnrollments.id,
          threadId: followupEnrollments.threadId,
          nextEvalAt: followupEnrollments.nextEvalAt,
          subject: threads.subject,
        })
        .from(followupEnrollments)
        .leftJoin(threads, eq(threads.id, followupEnrollments.threadId))
        .where(
          and(
            eq(followupEnrollments.userId, userId),
            eq(followupEnrollments.status, "active"),
            lte(followupEnrollments.nextEvalAt, endOfDay),
          ),
        )
        .orderBy(asc(followupEnrollments.nextEvalAt))
        .limit(MAX_FOLLOWUPS),
      db
        .select()
        .from(commitments)
        .where(
          and(
            eq(commitments.userId, userId),
            eq(commitments.status, "open"),
            isNotNull(commitments.dueAt),
            lte(commitments.dueAt, windowEnd),
          ),
        )
        .orderBy(asc(commitments.dueAt))
        .limit(MAX_PROMISES),
      db
        .select()
        .from(meetings)
        .where(
          and(
            eq(meetings.userId, userId),
            gte(meetings.startAt, now),
            lte(meetings.startAt, windowEnd),
          ),
        )
        .orderBy(asc(meetings.startAt))
        .limit(MAX_MEETINGS),
    ]);

  // Replies: attach the prepared draft plus any open promise on the thread.
  const replyThreadIds = replyItems.map((item) => item.threadId);
  const replyCommitments = new Map<
    string,
    Array<{ id: string; direction: string; description: string }>
  >();
  if (replyThreadIds.length > 0) {
    const rows = await db
      .select({
        id: commitments.id,
        threadId: commitments.threadId,
        direction: commitments.direction,
        description: commitments.description,
      })
      .from(commitments)
      .where(
        and(
          eq(commitments.userId, userId),
          eq(commitments.status, "open"),
          inArray(commitments.threadId, replyThreadIds),
        ),
      );
    for (const row of rows) {
      if (!row.threadId) continue;
      const list = replyCommitments.get(row.threadId) ?? [];
      list.push({
        id: row.id,
        direction: row.direction,
        description: row.description,
      });
      replyCommitments.set(row.threadId, list);
    }
  }

  const replies: BriefingReply[] = await Promise.all(
    replyItems.map(async (item) => ({
      threadId: item.threadId,
      from: item.from,
      fromName: item.fromName,
      subject: item.subject,
      summary: item.hasPendingDraft ? null : item.snippet,
      draft: item.hasPendingDraft ? await latestPendingDraft(item.threadId) : null,
      commitments: replyCommitments.get(item.threadId) ?? [],
    })),
  );

  // Follow-ups: attach the nudge draft and the last time we reached out.
  const followups: BriefingFollowup[] = await Promise.all(
    followupRows.map(async (row) => {
      const [draft, latestInbound, latestOutbound] = await Promise.all([
        latestPendingDraft(row.threadId),
        db
          .select({ fromAddr: messages.fromAddr })
          .from(messages)
          .where(
            and(
              eq(messages.threadId, row.threadId),
              eq(messages.direction, "inbound"),
            ),
          )
          .orderBy(desc(messages.sentAt))
          .limit(1),
        db
          .select({ sentAt: messages.sentAt })
          .from(messages)
          .where(
            and(
              eq(messages.threadId, row.threadId),
              eq(messages.direction, "outbound"),
            ),
          )
          .orderBy(desc(messages.sentAt))
          .limit(1),
      ]);
      return {
        enrollmentId: row.enrollmentId,
        threadId: row.threadId,
        from: latestInbound[0]?.fromAddr ?? null,
        subject: row.subject,
        dueAt: row.nextEvalAt ? row.nextEvalAt.toISOString() : null,
        lastSentAt: latestOutbound[0]?.sentAt
          ? latestOutbound[0].sentAt.toISOString()
          : null,
        draft,
      };
    }),
  );

  // Promises: attach the chaser/reminder draft already prepared for the thread.
  const promises: BriefingPromise[] = await Promise.all(
    promiseRows.map(async (row) => ({
      commitmentId: row.id,
      threadId: row.threadId,
      direction: row.direction,
      description: row.description,
      dueAt: row.dueAt ? row.dueAt.toISOString() : null,
      overdue: row.dueAt ? row.dueAt.getTime() < now.getTime() : false,
      draft: row.threadId ? await latestPendingDraft(row.threadId) : null,
    })),
  );

  // Meetings: the cached brief (deterministic when no model).
  const meetingCards: BriefingMeeting[] = await Promise.all(
    meetingRows.map(async (row) => ({
      meetingId: row.id,
      subject: row.subject,
      startAt: row.startAt ? row.startAt.toISOString() : null,
      meetLink: row.meetLink,
      brief: await generateMeetingBrief({
        userId,
        meetingId: row.id,
        now,
      }).catch(() => null),
    })),
  );

  const name = userRows[0]?.name?.trim().split(/\s+/)[0] ?? "there";
  const total =
    replies.length + followups.length + promises.length + meetingCards.length;
  const daypart = daypartForHour(getZonedParts(now, timeZone).hour);

  return {
    generatedAt: now.toISOString(),
    greeting: { name, total, daypart },
    counts,
    replies,
    followups,
    promises,
    meetings: meetingCards,
  };
}

/** Cached `buildBriefing` (10-minute TTL). */
export async function getBriefing(
  userId: string,
  { now = new Date(), force = false }: { now?: Date; force?: boolean } = {},
): Promise<Briefing> {
  if (!force) {
    try {
      const cached = await redis.get<string>(briefingCacheKey(userId));
      if (cached) {
        const parsed =
          typeof cached === "string" ? (JSON.parse(cached) as Briefing) : null;
        if (parsed && typeof parsed.generatedAt === "string") return parsed;
      }
    } catch (error) {
      console.warn("[briefing] cache read failed", error);
    }
  }

  const briefing = await buildBriefing(userId, now);

  try {
    await redis.set(briefingCacheKey(userId), JSON.stringify(briefing), {
      ex: BRIEFING_CACHE_TTL_SECONDS,
    });
  } catch (error) {
    console.warn("[briefing] cache write failed", error);
  }

  return briefing;
}
