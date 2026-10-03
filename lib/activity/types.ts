import type { DitherColor } from "@/components/dither-kit";

/**
 * Shape of the Activity dashboard payload.
 *
 * Kept free of `server-only` so presentational components can import the types
 * without pulling the database layer into their module graph.
 */

export type ActivityStatus =
  | "completed"
  | "failed"
  | "running"
  | "limit_reached"
  | "aborted"
  | string;

export type ActivityStats = {
  runs: number;
  completed: number;
  failed: number;
  running: number;
  limitReached: number;
  aborted: number;
  /** completed / (completed + failed + limit_reached). 1 when nothing resolved. */
  successRate: number;
  avgLatencyMs: number;
  avgSteps: number;
};

export type ActivityTokenDay = {
  /** YYYY-MM-DD in the viewer's timezone. */
  date: string;
  /** Weekday label, e.g. "Mon". */
  label: string;
  /** Short date, e.g. "9/28". */
  short: string;
  total: number;
  prompt: number;
  completion: number;
  runs: number;
  /** Runs this day that finished cleanly. */
  completed: number;
  /** Runs this day that resolved as failures (failed + limit_reached). */
  failed: number;
  /** completed / resolved for the day; null when nothing resolved that day. */
  successRate: number | null;
  /** Mean run latency for the day, in ms; 0 when no run reported one. */
  avgLatencyMs: number;
  isToday: boolean;
};

export type ActivityModel = {
  model: string;
  runs: number;
  tokens: number;
  /** 0..1 of windowed tokens. */
  share: number;
};

export type ActivityEmailMixItem = {
  /** Raw sender category from the sender taxonomy, e.g. "Personal". */
  category: string;
  /** Friendly label, e.g. "One-on-one". */
  label: string;
  count: number;
  /** 0..1 of inbound mail in the window. */
  share: number;
};

export type ActivityTool = {
  name: string;
  /** Human label, e.g. "Searched inbox". */
  label: string;
  calls: number;
  errors: number;
  share: number;
};

export type ActivityHeatDay = {
  date: string;
  label: string;
  /** One count per 3-hour bucket, 00:00 → 23:59. */
  buckets: number[];
  total: number;
};

export type ActivityFeedItem = {
  id: string;
  /** Operator outcomes only — model turns live in the Overview, not the log. */
  kind: "draft" | "meeting" | "action";
  title: string;
  detail: string;
  status: string;
  tokens: number;
  ms: number | null;
  /** ISO timestamp. */
  at: string;
  href?: string;
};

export type ActivityMilestone = {
  id: string;
  label: string;
  caption: string;
  icon: ActivityMilestoneIcon;
  earned: boolean;
};

export type ActivityMilestoneIcon =
  | "run"
  | "tokens"
  | "accuracy"
  | "tools"
  | "calendar"
  | "reply";

export type ActivityBudget = {
  dailyLimit: number;
  dailyUsed: number;
  dailyRemaining: number;
  /** 0..1 of the daily call budget consumed. */
  percentUsed: number;
  disabled: boolean;
  /** When the counter rolls over (UTC midnight). */
  resetsAt: string;
  /** Windowed token spend, estimated from configured model rates. */
  estimatedCostUsd: number;
  windowTokens: number;
  costBasis: string;
  /**
   * Today's model calls grouped by what they were spent on, plus a reserved
   * slice for what is left. Built from the AI usage ledger, so every count is a
   * row the runtime actually wrote.
   */
  breakdown: ActivityUsageSlice[];
  /** True when `breakdown` is ledger-backed; false when only the guard counter was reachable. */
  attributed: boolean;
};

export type ActivityUsageSlice = {
  /** Stable key — also the pie chart's slice name/key in its config. */
  key: string;
  label: string;
  /** Model calls attributed to this group today. */
  calls: number;
  /** Tokens attributed to this group today. */
  tokens: number;
  /** Estimated spend for this group today, in micro-USD. */
  costMicros: number;
  /** 0..1 of today's attributed calls (0 for the reserved "left" slice). */
  share: number;
  color: DitherColor;
  /** Reserved slice: the daily budget not yet spent, not an activity group. */
  reserved?: boolean;
};

export type ActivitySender = {
  email: string;
  /** Short, collision-proof display label (local part, truncated). */
  label: string;
  messages: number;
};

export type ActivityOutcomes = {
  draftsCreated: number;
  repliesSent: number;
  meetingsBooked: number;
  followupsActive: number;
  approvalsSucceeded: number;
  approvalsPending: number;
  approvalsFailed: number;
  autonomy: "copilot" | "autopilot";
  /** resolved / (resolved + pending). 1 when nothing is waiting. */
  resolvedShare: number;
};

export type ActivityAutopilotReason = {
  reason: string;
  label: string;
  count: number;
};

/** 24/7 Autopilot health: sends, gate reasons, caps and push health. */
export type ActivityAutopilot = {
  enabled: boolean;
  mode: "window" | "always";
  windowLabel: string;
  sendsToday: number;
  sendsWindow: number;
  held: number;
  capHits: number;
  /** Decision counts by reason, newest window first, most frequent first. */
  decisions: ActivityAutopilotReason[];
  /** Mailboxes with a lapsed/expiring watch or a sync failure. */
  watchUnhealthy: number;
  /** Jobs that exhausted their retries and need attention. */
  deadJobs: number;
};

export type ActivityDashboard = {
  timezone: string;
  windowDays: number;
  heatDays: number;
  /** ISO timestamp of render. */
  generatedAt: string;
  /** True once the account has ever produced a run or a flow execution. */
  hasData: boolean;
  stats: ActivityStats;
  totals: {
    runs: number;
    tokens: number;
    promptTokens: number;
    completionTokens: number;
    todayRuns: number;
    todayTokens: number;
  };
  /** Fractional change vs the previous equal window. */
  deltas: { runs: number; tokens: number };
  daily: ActivityTokenDay[];
  heat: ActivityHeatDay[];
  peak: { day: string; window: string; count: number } | null;
  busiestDay: { label: string; count: number } | null;
  /** Consecutive days ending today with at least one run. */
  streak: number;
  models: ActivityModel[];
  tools: ActivityTool[];
  milestones: ActivityMilestone[];
  feed: ActivityFeedItem[];
  emailMix: ActivityEmailMixItem[];
  /** Top inbound senders, by message count, for the week and the month. */
  senders: { week: ActivitySender[]; month: ActivitySender[] };
  budget: ActivityBudget;
  outcomes: ActivityOutcomes;
  autopilot: ActivityAutopilot;
};
