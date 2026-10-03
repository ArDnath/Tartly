import "server-only";

import {
  DEFAULT_AI_DAILY_BUDGET,
  budgetKey,
  isBudgetDisabled,
} from "@/lib/ai/budget";
import { getAiUsageSummary, type AiUsageSummary } from "@/lib/ai/usage";
import { pool } from "@/lib/db";
import { redis } from "@/lib/redis";
import { activityRepository } from "@/lib/repositories/activity";
import { autopilotRepository } from "@/lib/repositories/autopilot";
import { followupEnrollmentRepository } from "@/lib/repositories/followup-enrollments";
import { meetingRepository } from "@/lib/repositories/meetings";
import { getUnhealthyWatches } from "@/lib/gmail/watch";
import {
  autopilotReasonLabel,
  getAutopilotPolicy,
} from "@/lib/settings/autopilot";

import type {
  ActivityAutopilot,
  ActivityDashboard,
  ActivityEmailMixItem,
  ActivityFeedItem,
  ActivityHeatDay,
  ActivityMilestone,
  ActivityModel,
  ActivityStatus,
  ActivityTokenDay,
  ActivityTool,
  ActivityUsageSlice,
} from "./types";
import { HEAT_BUCKETS, HEAT_BUCKET_HOURS, heatWindowLabel } from "./format";
/**
 * Aggregates everything the Activity board renders, from rows that already
 * exist — no new tables. Agent runs carry the token/latency/status record; flow
 * runs, drafts, meetings, follow-ups and pending actions supply the operator
 * side; the per-user daily AI budget comes from the same Redis counter the
 * runtime already guards on.
 *
 * Every numeric field is derived, never invented: where the product has no
 * source (a monthly dollar allowance, per-provider billing), the board shows the
 * real signal instead and labels any estimate as such.
 */

const WINDOW_DAYS = 14;
const HEAT_DAYS = 7;
const FEED_LIMIT = 11;

/**
 * Illustrative blended rates for the configured gateway model, used only for the
 * "estimated spend" line. These are a display estimate, not billing truth —
 * update them if the provider publishes rates.
 */
const INPUT_RATE_PER_MILLION = 0.15;
const OUTPUT_RATE_PER_MILLION = 0.6;
const COST_BASIS = `est. $${INPUT_RATE_PER_MILLION}/M in · $${OUTPUT_RATE_PER_MILLION}/M out`;

const TOOL_LABELS: Record<string, string> = {
  search_emails: "Searched inbox",
  search_contacts: "Searched contacts",
  get_email: "Read an email",
  get_contact: "Read a contact",
  get_thread: "Read a thread",
  reply_to_email: "Drafted a reply",
  send_email: "Sent an email",
};

/** Sender-taxonomy → the plain-English label the board shows. */
const EMAIL_CATEGORY_LABELS: Record<string, string> = {
  Personal: "One-on-one",
  Work: "Work",
  Financial: "Financial",
  Receipts: "Receipts",
  Newsletters: "Newsletters",
  Marketing: "Marketing",
  Notifications: "Notifications",
  "Cold Outreach": "Cold outreach",
  Other: "Other",
};

/**
 * Ledger features → the activity buckets the budget donut shows. Every feature
 * recorded by `recordAiUsage` maps to exactly one group; anything unmapped falls
 * through to "Other" so no spend is ever dropped from the pie.
 */
const USAGE_GROUPS: Array<{
  key: string;
  label: string;
  features: string[];
}> = [
  {
    key: "triage",
    label: "Triage",
    features: ["triage", "classify-intent", "categorize-sender"],
  },
  {
    key: "drafts",
    label: "Draft replies",
    features: ["draft-reply", "compose-assist", "draft-in-my-voice"],
  },
  {
    key: "followups",
    label: "Follow-ups",
    features: ["followup-draft"],
  },
  {
    key: "assistant",
    label: "Assistant & search",
    features: ["agent-chat", "chat-compaction", "structured"],
  },
  {
    key: "meetings",
    label: "Meetings",
    features: ["meeting-brief"],
  },
  {
    key: "digest",
    label: "Digest & summaries",
    features: ["digest", "summarize-thread"],
  },
  {
    key: "campaigns",
    label: "Campaigns",
    features: [
      "campaign-import",
      "campaign-personalize",
      "campaign-spam-check",
      "campaign-reply",
    ],
  },
  {
    key: "automation",
    label: "Rules & tasks",
    features: [
      "compile-rule",
      "rule-evaluate",
      "extract-tasks",
      "extract-commitments",
    ],
  },
  {
    key: "memory",
    label: "Memory & style",
    features: [
      "reply-memory-extraction",
      "reply-memory-exchange",
      "reply-memory-selection",
      "writing-style",
    ],
  },
  {
    key: "reports",
    label: "Reports",
    features: ["weekly-report"],
  },
  {
    key: "translate",
    label: "Translate",
    features: ["translate"],
  },
  {
    key: "research",
    label: "Research",
    features: ["cold-email"],
  },
];

const USAGE_GROUP_BY_FEATURE = new Map(
  USAGE_GROUPS.flatMap((group) =>
    group.features.map((feature) => [feature, group] as const),
  ),
);

/** Vivid slots for the used groups; the reserved "left" slice takes grey. */
const USED_COLORS: ActivityUsageSlice["color"][] = [
  "green",
  "blue",
  "purple",
  "pink",
  "orange",
  "red",
];

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, " ");
}

/** Short, collision-proof label for a sender's email, e.g. "maya.chen…". */
function senderLabel(email: string): string {
  const local = email.split("@")[0] ?? email;
  if (local.length === 0) return email.slice(0, 12);
  return local.length <= 12 ? local : `${local.slice(0, 11)}…`;
}

/* ------------------------------------------------------------------ */
/*  Timezone-aware bucketing                                           */
/* ------------------------------------------------------------------ */

function zoneDayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function zoneHour(date: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(date),
  );
}

function zoneWeekday(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
}

function zoneShort(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "numeric",
    day: "numeric",
  }).format(date);
}

function formatBucket(bucket: number): string {
  return heatWindowLabel(bucket);
}

/* ------------------------------------------------------------------ */
/*  Budget                                                             */
/* ------------------------------------------------------------------ */

/** Reads the daily AI-call counter without consuming it. Fails soft. */
async function readDailyBudgetUsed(
  userId: string,
  now: Date,
): Promise<number> {
  try {
    const key = budgetKey(userId, now);
    const raw = await Promise.race([
      redis.get<string>(key),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch (error) {
    console.warn("[activity] budget counter unavailable", error);
    return 0;
  }
}

/** Reads the attribution ledger for the day. Fails soft so the board still renders. */
async function readUsageSummary(
  userId: string,
  since: Date,
  until: Date,
): Promise<AiUsageSummary | null> {
  try {
    return await getAiUsageSummary({ userId, since, until });
  } catch (error) {
    console.warn("[activity] usage ledger unavailable", error);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function fraction(current: number, previous: number): number {
  if (previous > 0) return (current - previous) / previous;
  return current > 0 ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/*  Service                                                            */
/* ------------------------------------------------------------------ */

export async function getActivityDashboard({
  userId,
  now = new Date(),
}: {
  userId: string;
  now?: Date;
}): Promise<ActivityDashboard> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const previousSince = new Date(now.getTime() - 2 * WINDOW_DAYS * 86_400_000);
  const weekSince = new Date(now.getTime() - 7 * 86_400_000);
  const monthSince = new Date(now.getTime() - 30 * 86_400_000);
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);

  const [
    timezoneRaw,
    runs,
    flowWindow,
    draftsByStatus,
    meetingsBooked,
    followupsActive,
    pendingByStatus,
    autonomy,
    recentDrafts,
    recentMeetings,
    recentActions,
    budgetUsed,
    lifetime,
    previous,
    toolsRaw,
    distinctTools,
    emailMixRaw,
    todayUsage,
    senderWeek,
    senderMonth,
  ] = await Promise.all([
    activityRepository.findCalendarTimezone(userId),
    activityRepository.listRunsSince({ userId, since }),
    activityRepository.listFlowRunsSince({ userId, since }),
    activityRepository.countDraftsByStatusSince({ userId, since }),
    meetingRepository.countCreatedSince(userId, since),
    followupEnrollmentRepository.countActive(userId),
    activityRepository.countPendingActionsByStatusSince({ userId, since }),
    activityRepository.findFirstMailboxAutonomy(userId),
    activityRepository.listRecentDrafts({ userId, since, limit: 3 }),
    activityRepository.listRecentMeetings({ userId, since, limit: 2 }),
    activityRepository.listRecentPendingActions({ userId, since, limit: 3 }),
    readDailyBudgetUsed(userId, now),
    activityRepository.getLifetimeRunStats(userId),
    activityRepository.getRunStatsBetween({ userId, from: previousSince, to: since }),
    activityRepository.listToolUsage({ userId, since, limit: 8 }),
    activityRepository.countDistinctTools(userId),
    activityRepository.listInboundByCategory({ userId, since }),
    readUsageSummary(userId, dayStart, now),
    activityRepository.listTopSenders({ userId, since: weekSince, limit: 6 }),
    activityRepository.listTopSenders({ userId, since: monthSince, limit: 6 }),
  ]);

  const timezone = timezoneRaw ?? "UTC";

  /* ---- day lattice ---- */
  const dayKeys: string[] = [];
  const dayDates: Date[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i -= 1) {
    const date = new Date(now.getTime() - i * 86_400_000);
    const key = zoneDayKey(date, timezone);
    if (dayKeys.at(-1) !== key) {
      dayKeys.push(key);
      dayDates.push(date);
    }
  }
  const todayKey = dayKeys.at(-1) ?? zoneDayKey(now, timezone);

  /* ---- run aggregates ---- */
  const statusCount = (status: ActivityStatus) =>
    runs.filter((run) => run.status === status).length;

  const completed = statusCount("completed");
  const failed = statusCount("failed");
  const running = statusCount("running");
  const limitReached = statusCount("limit_reached");
  const aborted = statusCount("aborted");
  const resolved = completed + failed + limitReached;

  const latencies = runs
    .map((run) => run.latencyMs ?? 0)
    .filter((value) => value > 0);

  const totalPrompt = runs.reduce(
    (total, run) => total + run.promptTokens,
    0,
  );
  const totalCompletion = runs.reduce(
    (total, run) => total + run.completionTokens,
    0,
  );
  const totalTokens = totalPrompt + totalCompletion;

  const todayRuns = runs.filter(
    (run) => zoneDayKey(run.startedAt, timezone) === todayKey,
  );
  const todayTokens = todayRuns.reduce(
    (total, run) => total + run.promptTokens + run.completionTokens,
    0,
  );

  const previousRuns = Number(previous.runs ?? 0);
  const previousTokens = Number(previous.tokens ?? 0);

  /* ---- daily series ---- */
  const byDay = new Map<
    string,
    {
      prompt: number;
      completion: number;
      runs: number;
      completed: number;
      failed: number;
      latencySum: number;
      latencySamples: number;
    }
  >();
  for (const run of runs) {
    const key = zoneDayKey(run.startedAt, timezone);
    const bucket = byDay.get(key) ?? {
      prompt: 0,
      completion: 0,
      runs: 0,
      completed: 0,
      failed: 0,
      latencySum: 0,
      latencySamples: 0,
    };
    bucket.prompt += run.promptTokens;
    bucket.completion += run.completionTokens;
    bucket.runs += 1;
    if (run.status === "completed") bucket.completed += 1;
    else if (run.status === "failed" || run.status === "limit_reached")
      bucket.failed += 1;
    if (run.latencyMs && run.latencyMs > 0) {
      bucket.latencySum += run.latencyMs;
      bucket.latencySamples += 1;
    }
    byDay.set(key, bucket);
  }

  const daily: ActivityTokenDay[] = dayKeys.map((key, index) => {
    const bucket = byDay.get(key) ?? {
      prompt: 0,
      completion: 0,
      runs: 0,
      completed: 0,
      failed: 0,
      latencySum: 0,
      latencySamples: 0,
    };
    const resolvedToday = bucket.completed + bucket.failed;
    return {
      date: key,
      label: zoneWeekday(dayDates[index]!, timezone),
      short: zoneShort(dayDates[index]!, timezone),
      total: bucket.prompt + bucket.completion,
      prompt: bucket.prompt,
      completion: bucket.completion,
      runs: bucket.runs,
      completed: bucket.completed,
      failed: bucket.failed,
      successRate:
        resolvedToday > 0 ? bucket.completed / resolvedToday : null,
      avgLatencyMs:
        bucket.latencySamples > 0
          ? Math.round(bucket.latencySum / bucket.latencySamples)
          : 0,
      isToday: key === todayKey,
    };
  });

  /* ---- heat matrix (last HEAT_DAYS × 3-hour buckets) ---- */
  const heatKeys = dayKeys.slice(-HEAT_DAYS);
  const heatDates = dayDates.slice(-HEAT_DAYS);
  const heatIndex = new Map(heatKeys.map((key, index) => [key, index]));
  const heat: ActivityHeatDay[] = heatKeys.map((key, index) => ({
    date: key,
    label: zoneWeekday(heatDates[index]!, timezone),
    buckets: new Array(HEAT_BUCKETS).fill(0) as number[],
    total: 0,
  }));

  for (const run of runs) {
    const key = zoneDayKey(run.startedAt, timezone);
    const index = heatIndex.get(key);
    if (index === undefined) continue;
    const bucket = Math.min(
      HEAT_BUCKETS - 1,
      Math.floor(zoneHour(run.startedAt, timezone) / HEAT_BUCKET_HOURS),
    );
    heat[index]!.buckets[bucket] += 1;
    heat[index]!.total += 1;
  }

  let peak: ActivityDashboard["peak"] = null;
  for (const day of heat) {
    for (let bucket = 0; bucket < day.buckets.length; bucket += 1) {
      const count = day.buckets[bucket] ?? 0;
      if ((peak === null || count > peak.count) && count > 0) {
        peak = { day: day.label, window: formatBucket(bucket), count };
      }
    }
  }

  const busiestDay = heat.reduce<{ label: string; count: number } | null>(
    (best, day) =>
      !best || day.total > best.count
        ? { label: day.label, count: day.total }
        : best,
    null,
  );

  /* ---- streak ---- */
  let streak = 0;
  for (let i = daily.length - 1; i >= 0; i -= 1) {
    if (daily[i]!.runs > 0) streak += 1;
    else break;
  }

  /* ---- models ---- */
  const modelMap = new Map<string, { runs: number; tokens: number }>();
  for (const run of runs) {
    const name = run.model ?? "unknown";
    const entry = modelMap.get(name) ?? { runs: 0, tokens: 0 };
    entry.runs += 1;
    entry.tokens += run.promptTokens + run.completionTokens;
    modelMap.set(name, entry);
  }
  const models: ActivityModel[] = [...modelMap.entries()]
    .map(([model, entry]) => ({
      model,
      runs: entry.runs,
      tokens: entry.tokens,
      share: totalTokens > 0 ? entry.tokens / totalTokens : 0,
    }))
    .sort((a, b) => b.tokens - a.tokens);

  /* ---- tools ---- */
  const totalToolCalls = toolsRaw.reduce(
    (total, row) => total + Number(row.calls),
    0,
  );
  const tools: ActivityTool[] = toolsRaw.map((row) => ({
    name: row.name,
    label: toolLabel(row.name),
    calls: Number(row.calls),
    errors: Number(row.errors),
    share: totalToolCalls > 0 ? Number(row.calls) / totalToolCalls : 0,
  }));

  /* ---- email mix (inbound mail by sender category) ---- */
  const emailTotal = emailMixRaw.reduce(
    (total, row) => total + Number(row.n),
    0,
  );
  const emailMix: ActivityEmailMixItem[] = emailMixRaw.map((row) => ({
    category: row.category,
    label: EMAIL_CATEGORY_LABELS[row.category] ?? row.category,
    count: Number(row.n),
    share: emailTotal > 0 ? Number(row.n) / emailTotal : 0,
  }));

  /* ---- lifetime + milestones ---- */
  const lifetimeRuns = Number(lifetime.runs ?? 0);
  const lifetimeTokens = Number(lifetime.tokens ?? 0);
  const successRate = resolved > 0 ? completed / resolved : 1;

  const milestones: ActivityMilestone[] = [
    {
      id: "first-run",
      label: "First run",
      caption: "The operator's first turn",
      icon: "run",
      earned: lifetimeRuns >= 1,
    },
    {
      id: "ten-runs",
      label: "10 runs",
      caption: "Ten turns completed",
      icon: "accuracy",
      earned: lifetimeRuns >= 10,
    },
    {
      id: "tokens-100k",
      label: "100K tokens",
      caption: "A hundred thousand processed",
      icon: "tokens",
      earned: lifetimeTokens >= 100_000,
    },
    {
      id: "tokens-1m",
      label: "1M tokens",
      caption: "A million processed",
      icon: "tokens",
      earned: lifetimeTokens >= 1_000_000,
    },
    {
      id: "tools-5",
      label: "5 tools",
      caption: "Five tools put to work",
      icon: "tools",
      earned: distinctTools >= 5,
    },
    {
      id: "smooth",
      label: "Smooth sailing",
      caption: "95%+ success over ten runs",
      icon: "reply",
      earned: lifetimeRuns >= 10 && successRate >= 0.95,
    },
  ];

  /* ---- budget ---- */
  const dailyLimit = DEFAULT_AI_DAILY_BUDGET;
  const resetsAt = new Date(now);
  resetsAt.setUTCHours(24, 0, 0, 0);

  const estimatedCostUsd =
    (totalPrompt / 1_000_000) * INPUT_RATE_PER_MILLION +
    (totalCompletion / 1_000_000) * OUTPUT_RATE_PER_MILLION;

  /* ---- budget attribution (usage ledger → activity groups) ---- */
  const groupTotals = new Map<
    string,
    { key: string; label: string; calls: number; tokens: number; costMicros: number }
  >();
  let attributedCalls = 0;
  for (const row of todayUsage?.byFeature ?? []) {
    const group = USAGE_GROUP_BY_FEATURE.get(row.feature);
    const key = group?.key ?? "other";
    const entry = groupTotals.get(key) ?? {
      key,
      label: group?.label ?? "Other",
      calls: 0,
      tokens: 0,
      costMicros: 0,
    };
    entry.calls += Number(row.calls);
    entry.tokens += Number(row.totalTokens);
    entry.costMicros += Number(row.estimatedCostMicros);
    groupTotals.set(key, entry);
    attributedCalls += Number(row.calls);
  }

  const hasAttribution = todayUsage !== null && attributedCalls > 0;
  // The ledger carries attribution, so it is the board's "used" when present;
  // otherwise fall back to the guard counter so the panel is never blank.
  const dailyUsed = hasAttribution ? attributedCalls : budgetUsed;
  const dailyRemaining = Math.max(0, dailyLimit - dailyUsed);
  const percentUsed = dailyLimit > 0 ? dailyUsed / dailyLimit : 0;

  const breakdown: ActivityUsageSlice[] = [];
  if (hasAttribution) {
    const ranked = [...groupTotals.values()].sort((a, b) => b.calls - a.calls);
    const head = ranked.slice(0, 5);
    head.forEach((entry, index) => {
      breakdown.push({
        key: entry.key,
        label: entry.label,
        calls: entry.calls,
        tokens: entry.tokens,
        costMicros: entry.costMicros,
        share: attributedCalls > 0 ? entry.calls / attributedCalls : 0,
        color: USED_COLORS[index] ?? "grey",
      });
    });
    const tail = ranked.slice(5);
    if (tail.length > 0) {
      const merged = tail.reduce(
        (acc, entry) => ({
          calls: acc.calls + entry.calls,
          tokens: acc.tokens + entry.tokens,
          costMicros: acc.costMicros + entry.costMicros,
        }),
        { calls: 0, tokens: 0, costMicros: 0 },
      );
      const existing = breakdown.find((slice) => slice.key === "other");
      if (existing) {
        existing.calls += merged.calls;
        existing.tokens += merged.tokens;
        existing.costMicros += merged.costMicros;
        existing.share =
          attributedCalls > 0 ? existing.calls / attributedCalls : 0;
      } else {
        breakdown.push({
          key: "other",
          label: "Other",
          calls: merged.calls,
          tokens: merged.tokens,
          costMicros: merged.costMicros,
          share: attributedCalls > 0 ? merged.calls / attributedCalls : 0,
          color: "red",
        });
      }
    }
  } else {
    breakdown.push({
      key: "used",
      label: "Used today",
      calls: dailyUsed,
      tokens: 0,
      costMicros: 0,
      share: 0,
      color: "blue",
    });
  }
  breakdown.push({
    key: "left",
    label: "Left today",
    calls: dailyRemaining,
    tokens: 0,
    costMicros: 0,
    share: 0,
    color: "grey",
    reserved: true,
  });

  /* ---- outcomes ---- */
  const draftCount = (status: string) =>
    draftsByStatus
      .filter((row) => row.status === status)
      .reduce((total, row) => total + Number(row.n), 0);
  const pendingCount = (status: string) =>
    pendingByStatus
      .filter((row) => row.status === status)
      .reduce((total, row) => total + Number(row.n), 0);

  const approvalsSucceeded = pendingCount("SUCCEEDED");
  const approvalsPending = pendingCount("PENDING") + pendingCount("EXECUTING");
  const approvalsFailed = pendingCount("FAILED") + pendingCount("EXPIRED");
  const approvalsResolved = approvalsSucceeded + approvalsFailed;

  /* ---- feed: operator outcomes only (model turns stay in Overview) ---- */
  const feed: ActivityFeedItem[] = [];
  const push = (item: Omit<ActivityFeedItem, "at"> & { at: Date }) => {
    feed.push({ ...item, at: item.at.toISOString() });
  };

  for (const action of recentActions) {
    push({
      id: `action-${action.id}`,
      kind: "action",
      title: toolLabel(action.toolName),
      detail: `needs your approval · ${action.status.toLowerCase()}`,
      status: action.status.toLowerCase(),
      tokens: 0,
      ms: null,
      at: action.createdAt,
    });
  }

  for (const draft of recentDrafts) {
    push({
      id: `draft-${draft.id}`,
      kind: "draft",
      title: draft.status === "sent" ? "Reply sent" : "Reply drafted",
      detail:
        draft.status === "sent"
          ? "delivered from your inbox"
          : draft.status === "discarded"
            ? "discarded"
            : "awaiting your approval",
      status: draft.status,
      tokens: 0,
      ms: null,
      at: draft.createdAt,
    });
  }

  for (const meeting of recentMeetings) {
    push({
      id: `meeting-${meeting.id}`,
      kind: "meeting",
      title: "Meeting booked",
      detail: meeting.subject ?? "confirmed on your calendar",
      status: meeting.status,
      tokens: 0,
      ms: null,
      at: meeting.createdAt,
    });
  }

  feed.sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );

  const hasData = lifetimeRuns > 0 || flowWindow.length > 0;

  const autopilot = await buildAutopilotActivity({
    userId,
    now,
    dayStart,
    weekSince,
  }).catch(() => emptyAutopilot());

  return {
    timezone,
    windowDays: WINDOW_DAYS,
    heatDays: HEAT_DAYS,
    generatedAt: now.toISOString(),
    hasData,
    stats: {
      runs: runs.length,
      completed,
      failed,
      running,
      limitReached,
      aborted,
      successRate,
      avgLatencyMs: Math.round(mean(latencies)),
      avgSteps: Number(mean(runs.map((run) => run.stepCount)).toFixed(1)),
    },
    totals: {
      runs: runs.length,
      tokens: totalTokens,
      promptTokens: totalPrompt,
      completionTokens: totalCompletion,
      todayRuns: todayRuns.length,
      todayTokens,
    },
    deltas: {
      runs: fraction(runs.length, previousRuns),
      tokens: fraction(totalTokens, previousTokens),
    },
    daily,
    heat,
    peak,
    busiestDay,
    streak,
    models,
    tools,
    milestones,
    feed: feed.slice(0, FEED_LIMIT),
    emailMix,
    senders: {
      week: senderWeek.map((row) => ({
        email: row.email,
        label: senderLabel(row.email),
        messages: Number(row.n),
      })),
      month: senderMonth.map((row) => ({
        email: row.email,
        label: senderLabel(row.email),
        messages: Number(row.n),
      })),
    },
    budget: {
      dailyLimit,
      dailyUsed,
      dailyRemaining,
      percentUsed,
      disabled: isBudgetDisabled(),
      resetsAt: resetsAt.toISOString(),
      estimatedCostUsd,
      windowTokens: totalTokens,
      costBasis: COST_BASIS,
      breakdown,
      attributed: hasAttribution,
    },
    outcomes: {
      draftsCreated: draftsByStatus.reduce(
        (total, row) => total + Number(row.n),
        0,
      ),
      repliesSent: draftCount("sent"),
      meetingsBooked,
      followupsActive,
      approvalsSucceeded,
      approvalsPending,
      approvalsFailed,
      autonomy:
        autonomy === "autopilot" ? "autopilot" : "copilot",
      resolvedShare:
        approvalsResolved + approvalsPending > 0
          ? approvalsResolved / (approvalsResolved + approvalsPending)
          : 1,
    },
    autopilot,
  };
}

function emptyAutopilot(): ActivityAutopilot {
  return {
    enabled: false,
    mode: "window",
    windowLabel: "Off",
    sendsToday: 0,
    sendsWindow: 0,
    held: 0,
    capHits: 0,
    decisions: [],
    watchUnhealthy: 0,
    deadJobs: 0,
  };
}

const CAP_REASONS = new Set(["hour_cap", "day_cap", "thread_cap"]);

async function buildAutopilotActivity({
  userId,
  now,
  dayStart,
  weekSince,
}: {
  userId: string;
  now: Date;
  dayStart: Date;
  weekSince: Date;
}): Promise<ActivityAutopilot> {
  const [policy, decisions, watches, dead] = await Promise.all([
    getAutopilotPolicy(userId),
    autopilotRepository.listDecisionsSince(userId, weekSince, 500),
    getUnhealthyWatches({ now }).catch(() => []),
    pool
      .query<{ count: string }>(
        `select count(*)::text as count from job_queue where user_id = $1 and status = 'dead'`,
        [userId],
      )
      .then((result) => Number(result.rows[0]?.count ?? 0))
      .catch(() => 0),
  ]);

  const byReason = new Map<string, number>();
  let sendsToday = 0;
  let sendsWindow = 0;
  let held = 0;
  let capHits = 0;

  for (const row of decisions) {
    byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + 1);
    if (row.decision === "send") {
      sendsWindow += 1;
      if (row.createdAt.getTime() >= dayStart.getTime()) sendsToday += 1;
    } else {
      held += 1;
    }
    if (CAP_REASONS.has(row.reason)) capHits += 1;
  }

  const pad = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
  const windowLabel =
    policy.mode === "always"
      ? "Any time"
      : policy.enabled
        ? `${pad(policy.windowStartHour)}–${pad(policy.windowEndHour)} (${policy.timezone})`
        : "Off";

  return {
    enabled: policy.enabled,
    mode: policy.mode,
    windowLabel,
    sendsToday,
    sendsWindow,
    held,
    capHits,
    decisions: [...byReason.entries()]
      .map(([reason, count]) => ({
        reason,
        label: autopilotReasonLabel(reason),
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    watchUnhealthy: watches.filter((watch) => watch.userId === userId).length,
    deadJobs: dead,
  };
}
