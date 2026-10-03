/**
 * Pure inbox view types and predicates.
 *
 * Kept free of `server-only`, database and Next imports so the sidebar (a
 * Client Component) can resolve `?view=` aliases and bucket rows without
 * pulling the server service into the browser bundle. `lib/inbox/service.ts`
 * re-exports everything here for existing server callers.
 */

export type InboxView =
  | "needs_reply"
  | "follow_up_today"
  | "meetings"
  | "waiting"
  | "ai_handled"
  | "fyi";

/** The six buckets, in precedence order (first match wins). */
export const INBOX_VIEWS: readonly InboxView[] = [
  "needs_reply",
  "follow_up_today",
  "meetings",
  "waiting",
  "ai_handled",
  "fyi",
];

export type InboxItem = {
  threadId: string;
  subject: string | null;
  from: string | null;
  fromName: string | null;
  snippet: string | null;
  category: string | null;
  priority: number;
  action: string | null;
  isUnread: boolean;
  lastMessageAt: string | null;
  hasPendingDraft: boolean;
  /** Phase 2: sender intelligence for the row's chip. */
  senderCategory: string | null;
  isColdEmail: boolean;
  /** Phase 4 Reply Zero: "needs_reply" | "awaiting_them" | "none" | null. */
  replyStatus: string | null;
  /** 24/7 autopilot: an AI reply was sent for this thread overnight. */
  handledOvernight: boolean;
  /** The bucket this row is in, so the UI can trust the assignment. */
  bucket: InboxView;
};

/**
 * Resolve a `?view=` value to a bucket. Legacy deep links keep working as
 * aliases: `needs_you` → needs_reply, `handled` → fyi.
 */
export function normalizeView(value: string | null | undefined): InboxView | null {
  if (!value) return null;
  if (value === "needs_you") return "needs_reply";
  if (value === "handled") return "fyi";
  return (INBOX_VIEWS as readonly string[]).includes(value)
    ? (value as InboxView)
    : null;
}

export type InboxBucketState = {
  category: string | null;
  action: string | null;
  replyStatus?: string | null;
  /** An active follow-up enrollment due by end of the local day. */
  hasDueFollowup?: boolean;
  /** An upcoming meeting, or a meeting request with an active proposal. */
  hasUpcomingMeeting?: boolean;
  /** The latest outbound was AI-sent and no newer inbound arrived. */
  aiHandled?: boolean;
};

/** Pure JS mirror of the SQL bucket expression, used for counts and the digest. */
export function bucketFor(state: InboxBucketState): InboxView {
  const { category, action, replyStatus } = state;
  if (
    category === null ||
    category === "needs_reply" ||
    category === "meeting_request" ||
    action === "handoff"
  ) {
    return "needs_reply";
  }
  if (state.hasDueFollowup) return "follow_up_today";
  if (state.hasUpcomingMeeting) return "meetings";
  if (category === "awaiting_reply" || replyStatus === "awaiting_them") {
    return "waiting";
  }
  if (state.aiHandled) return "ai_handled";
  return "fyi";
}

/** Pure predicate mirroring the bucket ladder, for JS bucketing and tests. */
export function matchesView(
  view: InboxView,
  state: InboxBucketState,
): boolean {
  return bucketFor(state) === view;
}

export type InboxCounts = {
  needs_reply: number;
  follow_up_today: number;
  meetings: number;
  waiting: number;
  ai_handled: number;
  fyi: number;
  unread: number;
};
