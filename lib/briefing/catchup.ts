import "server-only";

import { getAssistantSettings } from "@/lib/ai/features/draft-context";
import { getCalendarSettings } from "@/lib/calendar/settings";
import { getZonedParts } from "@/lib/calendar/tz";

import type {
  CatchUp,
  CatchUpDaypart,
  CatchUpOption,
  CatchUpPreviewItem,
} from "./catchup-types";
import { daypartForHour, getBriefing, type Briefing } from "./service";

/**
 * The catch-up popup's composition.
 *
 * `buildBriefing` already knows *what* is waiting; this turns that into *how we
 * say it* on reload: a headline that reads the local hour and how far past the
 * user's briefing it is, a one-line subhead, a short preview, and the plan of
 * options the agent can pick up.
 *
 * The builder is pure so it can be unit-tested without a database or model —
 * `getCatchUp` is the thin server wrapper that gathers the shopping list.
 */

/** More than this many hours past `briefingHour` and we say so out loud. */
export const LATE_AFTER_HOURS = 2;

const CATCH_UP_PROMPT =
  "Catch me up: what did I miss while I was away? Summarize the important " +
  "threads and flag anything that needs a decision.";

const DRAFT_REPLIES_PROMPT =
  "Draft replies for the threads that need a response. Show me each draft " +
  "before anything goes out.";

const MEETINGS_PROMPT =
  "Brief me on today's meetings — objective, agenda and any open questions for " +
  "each one.";

const PROMISES_PROMPT =
  "List my open promises in both directions, what's overdue, and what I should " +
  "do about them.";

const NUDGE_PROMPT =
  "Which threads are waiting on someone else? Draft a short nudge for the ones " +
  "that have gone quiet.";

const TRIAGE_PROMPT =
  "Triage my inbox and tell me what genuinely needs me versus what can wait.";

function firstName(value: string | null | undefined): string {
  return value?.trim().split(/\s+/)[0] || "there";
}

/** Humanised distance to an ISO timestamp, e.g. "in 2h" / "3h ago". */
function relativeTime(iso: string | null | undefined, now: Date): string | undefined {
  if (!iso) return undefined;
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return undefined;

  const diffMinutes = Math.round((target - now.getTime()) / 60_000);
  const absMinutes = Math.abs(diffMinutes);
  const ahead = diffMinutes >= 0;

  if (absMinutes < 1) return "now";
  if (absMinutes < 60) return ahead ? `in ${absMinutes}m` : `${absMinutes}m ago`;

  const hours = Math.round(absMinutes / 60);
  if (hours < 24) return ahead ? `in ${hours}h` : `${hours}h ago`;

  const days = Math.round(hours / 24);
  return ahead ? `in ${days}d` : `${days}d ago`;
}

/**
 * The big opening line. Lateness wins over the plain daypart greeting — the
 * whole point of the popup is to name the gap, not pretend it's a fresh start.
 */
export function buildCatchUpHeadline({
  name,
  daypart,
  late,
}: {
  name: string;
  daypart: CatchUpDaypart;
  late: boolean;
}): string {
  const who = firstName(name);
  if (daypart === "night") return `You're up late, ${who}.`;
  if (late) return `You're late, ${who}.`;

  switch (daypart) {
    case "morning":
      return `Good morning, ${who}.`;
    case "afternoon":
      return `Good afternoon, ${who}.`;
    case "evening":
      return `Good evening, ${who}.`;
  }
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function buildPreview(briefing: Briefing, now: Date): CatchUpPreviewItem[] {
  const items: CatchUpPreviewItem[] = [];

  for (const reply of briefing.replies.slice(0, 2)) {
    items.push({
      kind: "reply",
      title: reply.fromName ?? reply.from ?? "Someone",
      subtitle: reply.subject ?? undefined,
    });
  }
  for (const meeting of briefing.meetings.slice(0, 2)) {
    items.push({
      kind: "meeting",
      title: meeting.subject ?? "Meeting",
      subtitle: relativeTime(meeting.startAt, now),
    });
  }
  for (const promise of briefing.promises.slice(0, 2)) {
    items.push({
      kind: "promise",
      title: promise.description,
      subtitle: promise.overdue ? "Overdue" : relativeTime(promise.dueAt, now),
    });
  }
  for (const followup of briefing.followups.slice(0, 1)) {
    items.push({
      kind: "followup",
      title: followup.subject ?? "Thread",
      subtitle: relativeTime(followup.dueAt, now),
    });
  }

  return items.slice(0, 4);
}

/**
 * The plan the agent opens with. "Catch me up" is always first; every other
 * option only appears when the briefing actually has something for it, so the
 * list is short and never offers work that does not exist.
 */
export function buildCatchUpOptions(briefing: Briefing): CatchUpOption[] {
  const options: CatchUpOption[] = [
    {
      id: "catch-up",
      label: "Catch me up",
      description: "What happened while you were away",
      prompt: CATCH_UP_PROMPT,
    },
  ];

  const replyCount = briefing.replies.length;
  if (replyCount > 0) {
    options.push({
      id: "draft-replies",
      label: "Draft the replies",
      description: `${replyCount} ${plural(replyCount, "thread needs", "threads need")} a response`,
      prompt: DRAFT_REPLIES_PROMPT,
      count: replyCount,
    });
  }

  const meetingCount = briefing.meetings.length;
  if (meetingCount > 0) {
    options.push({
      id: "meetings",
      label: "Prep today's meetings",
      description: `${meetingCount} ${plural(meetingCount, "is", "are")} on the calendar`,
      prompt: MEETINGS_PROMPT,
      count: meetingCount,
    });
  }

  const promiseCount = briefing.promises.length;
  if (promiseCount > 0) {
    options.push({
      id: "promises",
      label: "Check my promises",
      description: "Open commitments, both directions",
      prompt: PROMISES_PROMPT,
      count: promiseCount,
    });
  }

  const followupCount = briefing.followups.length;
  if (followupCount > 0) {
    options.push({
      id: "nudge",
      label: "Nudge silent threads",
      description: `${followupCount} waiting on someone`,
      prompt: NUDGE_PROMPT,
      count: followupCount,
    });
  }

  options.push({
    id: "triage",
    label: "Triage my inbox",
    description: "Sort what needs you from what can wait",
    prompt: TRIAGE_PROMPT,
  });

  return options;
}

/** Turn a composed briefing into the popup's presentation. Pure. */
export function buildCatchUp({
  briefing,
  localHour,
  briefingHour,
  now = new Date(briefing.generatedAt),
}: {
  briefing: Briefing;
  localHour: number;
  briefingHour: number;
  now?: Date;
}): CatchUp {
  const name = briefing.greeting.name;
  const daypart = daypartForHour(localHour);
  const hoursBehind = localHour - briefingHour;
  const late = hoursBehind >= LATE_AFTER_HOURS;
  const total = briefing.greeting.total;

  const headline = buildCatchUpHeadline({ name, daypart, late });
  const subhead =
    total === 0
      ? "You're all clear — nothing needs you right now."
      : late
        ? `You're ${hoursBehind}h behind. ${total} ${plural(total, "thing is", "things are")} waiting.`
        : `${total} ${plural(total, "thing", "things")} worth your attention.`;

  return {
    daypart,
    headline,
    subhead,
    lateLabel: late ? `${hoursBehind}h past your ${briefingHour}:00 briefing` : null,
    total,
    counts: briefing.counts,
    preview: buildPreview(briefing, now),
    options: buildCatchUpOptions(briefing),
    generatedAt: briefing.generatedAt,
  };
}

/**
 * Compose the catch-up for a user: the cached briefing plus the settings that
 * make the copy time-aware. Never posts anything — retiring the briefing
 * thread is the point.
 */
export async function getCatchUp(
  userId: string,
  now: Date = new Date(),
): Promise<CatchUp> {
  const [briefing, config, settings] = await Promise.all([
    getBriefing(userId, { now }),
    getAssistantSettings(userId),
    getCalendarSettings(userId),
  ]);

  const timeZone = settings?.timezone ?? "UTC";
  const localHour = getZonedParts(now, timeZone).hour;

  return buildCatchUp({
    briefing,
    localHour,
    briefingHour: config.briefingHour,
  });
}
