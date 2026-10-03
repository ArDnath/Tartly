import type { InboxCounts } from "@/lib/inbox/views";

/**
 * The catch-up payload behind the reload popup.
 *
 * Deliberately free of `server-only`/DB imports so the server builder
 * (`lib/briefing/catchup.ts`) and the client popup/plan share one shape. The
 * briefing data model stays in `lib/briefing/service.ts`; this is only the
 * presentation the popup and the agent's opening plan need.
 */

/** Which part of the user's local day the popup is greeting them in. */
export type CatchUpDaypart = "morning" | "afternoon" | "evening" | "night";

export type CatchUpOptionId =
  | "catch-up"
  | "draft-replies"
  | "meetings"
  | "promises"
  | "nudge"
  | "triage";

/**
 * One clickable row in the agent's opening plan. Clicking it sends `prompt` to
 * the agent, which then does the work with its real tools.
 */
export type CatchUpOption = {
  id: CatchUpOptionId;
  label: string;
  /** One line under the label, e.g. "3 threads need a response". */
  description: string;
  /** The user turn sent to the agent when this option is chosen. */
  prompt: string;
  /** Optional count rendered as a badge. */
  count?: number;
};

/** A compact peek at what is waiting, shown inside the popup. */
export type CatchUpPreviewItem = {
  kind: "reply" | "meeting" | "promise" | "followup";
  title: string;
  subtitle?: string;
};

/** One overnight autopilot item, already resolved to a user-facing reason. */
export type CatchUpOvernightItem = {
  threadId: string;
  reasonLabel: string;
  at?: string;
};

/** The 24/7 autopilot block: what was sent / held while the user was away. */
export type CatchUpOvernight = {
  windowLabel: string;
  totals: { sent: number; drafted: number; blocked: number };
  sent: CatchUpOvernightItem[];
  drafted: CatchUpOvernightItem[];
  blocked: CatchUpOvernightItem[];
};

export type CatchUp = {
  daypart: CatchUpDaypart;
  /** The big, time-aware line: "You're late, Ariyaman." */
  headline: string;
  /** The one-line reason: what is actually waiting. */
  subhead: string;
  /** "6h past your 8:00 briefing", or null when the user is on time. */
  lateLabel: string | null;
  total: number;
  counts: InboxCounts;
  preview: CatchUpPreviewItem[];
  options: CatchUpOption[];
  /** Overnight autopilot activity, when the user has a policy enabled. */
  overnight: CatchUpOvernight | null;
  generatedAt: string;
};
