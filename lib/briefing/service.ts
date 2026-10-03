import "server-only";

import {
  generateMeetingBrief,
  type MeetingBrief,
} from "@/lib/ai/features/meeting-brief";
import { getCalendarSettings } from "@/lib/calendar/settings";
import { getZonedParts } from "@/lib/calendar/tz";
import { endOfLocalDay, getInboxCounts, listInbox } from "@/lib/inbox/service";
import type { InboxCounts } from "@/lib/inbox/service";
import { redis } from "@/lib/redis";
import { commitmentRepository } from "@/lib/repositories/commitments";
import { assistantSettingsRepository } from "@/lib/repositories/assistant-settings";
import { draftRepository } from "@/lib/repositories/drafts";
import { followupEnrollmentRepository } from "@/lib/repositories/followup-enrollments";
import { meetingRepository } from "@/lib/repositories/meetings";
import { messageRepository } from "@/lib/repositories/messages";
import { userRepository } from "@/lib/repositories/users";
import { getAutopilotPolicy } from "@/lib/settings/autopilot";
import {
  getOvernightSummary,
  type OvernightSummary,
} from "@/lib/settings/autopilot-usage";

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
  /** 24/7 autopilot activity since the send window opened; null when off. */
  overnight: OvernightSummary | null;
};

export function briefingCacheKey(userId: string): string {
  // v3: the payload gained `overnight`, so older cached payloads are invalid.
  return `briefing:v3:${userId}`;
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
  const draft = await draftRepository.findPendingByThread(threadId);
  return draft ? { id: draft.id, body: draft.body } : null;
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

  const [userName, counts, replyItems, followupRows, promiseRows, meetingRows] =
    await Promise.all([
      userRepository.findNameById(userId),
      getInboxCounts(userId),
      listInbox({ userId, view: "needs_reply", limit: MAX_REPLIES }),
      followupEnrollmentRepository.listActiveDueForUser({
        userId,
        before: endOfDay,
        limit: MAX_FOLLOWUPS,
      }),
      commitmentRepository.listOpenDueBefore({
        userId,
        before: windowEnd,
        limit: MAX_PROMISES,
      }),
      meetingRepository.listStartingBetween({
        userId,
        from: now,
        to: windowEnd,
        limit: MAX_MEETINGS,
      }),
    ]);

  // Replies: attach the prepared draft plus any open promise on the thread.
  const replyThreadIds = replyItems.map((item) => item.threadId);
  const replyCommitments = new Map<
    string,
    Array<{ id: string; direction: string; description: string }>
  >();
  if (replyThreadIds.length > 0) {
    const rows = await commitmentRepository.listOpenForThreads({
      userId,
      threadIds: replyThreadIds,
    });
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
        messageRepository.latestByThreadAndDirection(row.threadId, "inbound"),
        messageRepository.latestByThreadAndDirection(row.threadId, "outbound"),
      ]);
      return {
        enrollmentId: row.enrollmentId,
        threadId: row.threadId,
        from: latestInbound?.fromAddr ?? null,
        subject: row.subject,
        dueAt: row.nextEvalAt ? row.nextEvalAt.toISOString() : null,
        lastSentAt: latestOutbound?.sentAt
          ? latestOutbound.sentAt.toISOString()
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

  const name = userName?.trim().split(/\s+/)[0] ?? "there";
  const total =
    replies.length + followups.length + promises.length + meetingCards.length;
  const daypart = daypartForHour(getZonedParts(now, timeZone).hour);

  // 24/7 autopilot: what happened overnight. Best-effort and only when the
  // user has a policy enabled and the overnight review is not opted out.
  let overnight: OvernightSummary | null = null;
  try {
    const settingsRow = await assistantSettingsRepository.findByUser(userId);
    const reviewEnabled = settingsRow?.overnightReviewEnabled ?? true;
    if (reviewEnabled) {
      const policy = await getAutopilotPolicy(userId);
      if (policy.enabled) {
        const summary = await getOvernightSummary(userId, now, policy);
        const activity =
          summary.totals.sent + summary.totals.drafted + summary.totals.blocked;
        if (activity > 0) overnight = summary;
      }
    }
  } catch (error) {
    console.warn("[briefing] overnight summary failed", error);
  }

  return {
    generatedAt: now.toISOString(),
    greeting: { name, total, daypart },
    counts,
    replies,
    followups,
    promises,
    meetings: meetingCards,
    overnight,
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
