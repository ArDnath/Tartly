import "server-only";

import { nanoid } from "nanoid";
import { after } from "next/server";

import { learnFromDraftEdit } from "@/lib/ai/features/reply-memory";
import { MIN_MESSAGES_FOR_SUMMARY } from "@/lib/ai/features/summarize-thread";
import {
  buildPage,
  decodeCursor,
  DEFAULT_PAGE_LIMIT,
  type CursorValues,
  type PaginationMeta,
} from "@/lib/api/pagination";
import { getCalendarSettings } from "@/lib/calendar/settings";
import { addUtcDays, getZonedParts, zonedTimeToUtc } from "@/lib/calendar/tz";
import { pool } from "@/lib/db";
// NOTE: Gmail send, the durable queue/drain and the engine are imported
// *dynamically* inside the functions that need them. A static import would pull
// `lib/gmail/**`, `lib/email-operator/**`, `lib/queue/**` and `lib/engine/**`
// into the module graph of every consumer — including the `/assistant` server
// render (via `lib/briefing/service.ts`), which the Phase 7 guard forbids.
import { autopilotRepository } from "@/lib/repositories/autopilot";
import { contactRepository } from "@/lib/repositories/contacts";
import { draftRepository } from "@/lib/repositories/drafts";
import { flowRunRepository } from "@/lib/repositories/flow-runs";
import { mailboxRepository } from "@/lib/repositories/mailboxes";
import { messageRepository } from "@/lib/repositories/messages";
import { senderProfileRepository } from "@/lib/repositories/sender-profiles";
import { threadRepository } from "@/lib/repositories/threads";
import type {
  InboxCursor,
  InboxThreadRow,
} from "@/lib/repositories/threads";
import { threadStateRepository } from "@/lib/repositories/thread-states";
import {
  INBOX_VIEWS,
  type InboxCounts,
  type InboxItem,
  type InboxView,
} from "@/lib/inbox/views";

// Pure view helpers live in `lib/inbox/views.ts` (client-safe); re-export them
// here so the server service stays the one import for existing callers.
export {
  INBOX_VIEWS,
  bucketFor,
  matchesView,
  normalizeView,
  type InboxBucketState,
  type InboxCounts,
  type InboxItem,
  type InboxView,
} from "@/lib/inbox/views";

/**
 * Inbox read/write service. The inbox renders from Postgres — triage already
 * wrote `thread_states`, so opening a view costs no model call.
 *
 * All persistence goes through `lib/repositories/*`; this module owns the
 * inbox's business rules (bucketing inputs, DTO shaping, send/discard
 * orchestration).
 */

export type ThreadDetail = {
  thread: {
    id: string;
    subject: string | null;
    gmailThreadId: string;
    isUnread: boolean;
    lastMessageAt: string | null;
  };
  state: {
    category: string | null;
    priority: number;
    action: string | null;
    reason: string | null;
    replyStatus: string | null;
  } | null;
  senderProfile: {
    email: string;
    category: string;
    coldEmailScore: number;
    status: string;
    unsubscribeMethod: string | null;
  } | null;
  /** True once the thread is long enough to justify a summary. */
  canSummarize: boolean;
  messages: Array<{
    id: string;
    direction: string;
    from: string | null;
    to: string[];
    subject: string | null;
    bodyText: string | null;
    sentAt: string | null;
  }>;
  draft: { id: string; body: string; editedBody: string | null; status: string } | null;
  proposal: import("@/lib/calendar/booking").MeetingProposal | null;
  meeting: {
    id: string;
    startAt: string | null;
    endAt: string | null;
    meetLink: string | null;
    status: string;
  } | null;
};

/**
 * End of the user's local day, so "follow up today" means today in *their*
 * timezone rather than UTC's.
 */
export function endOfLocalDay(now: Date, timeZone: string): Date {
  const parts = getZonedParts(now, timeZone);
  const startOfNext = zonedTimeToUtc(
    { ...parts, hour: 0, minute: 0 },
    timeZone,
  );
  return new Date(addUtcDays(startOfNext, 1).getTime() - 1);
}

/**
 * Sidebar badge counts. Every bucket is counted with the same CASE expression
 * `listInbox` filters on, so a badge always equals the rows it links to.
 */
export async function getInboxCounts(userId: string): Promise<InboxCounts> {
  const now = new Date();
  const settings = await getCalendarSettings(userId);
  const endOfDay = endOfLocalDay(now, settings?.timezone ?? "UTC");

  const [perBucket, unread] = await Promise.all([
    Promise.all(
      INBOX_VIEWS.map(async (view) => {
        const total = await threadRepository.countByBucket({
          userId,
          view,
          now,
          endOfDay,
        });
        return [view, total] as const;
      }),
    ),
    threadRepository.countUnread(userId),
  ]);

  const counts: InboxCounts = {
    needs_reply: 0,
    follow_up_today: 0,
    meetings: 0,
    waiting: 0,
    ai_handled: 0,
    fyi: 0,
    unread,
  };
  for (const [view, total] of perBucket) {
    counts[view] = total;
  }

  return counts;
}

export async function listInbox({
  userId,
  view = "needs_reply",
  since,
  limit = 50,
}: {
  userId: string;
  view?: InboxView;
  since?: string | null;
  limit?: number;
}): Promise<InboxItem[]> {
  const rows = await fetchInboxRows({
    userId,
    view,
    since,
    limit: Math.min(limit, MAX_INBOX_LIMIT),
  });
  return hydrateInbox(userId, view, rows);
}

/** Cursor scope tag: keeps an inbox cursor from being replayed elsewhere. */
const INBOX_CURSOR_SCOPE = "inbox";
const MAX_INBOX_LIMIT = 100;

function inboxCursorOf(row: InboxThreadRow): CursorValues {
  return {
    p: row.state?.priority ?? null,
    m: row.thread.lastMessageAt
      ? row.thread.lastMessageAt.toISOString()
      : null,
    id: row.thread.id,
  };
}

/** Decode the opaque inbox cursor; a bad/foreign cursor restarts the list. */
function decodeInboxCursor(
  cursor: string | null | undefined,
): InboxCursor | undefined {
  const values = decodeCursor(cursor, INBOX_CURSOR_SCOPE, ["p", "m", "id"]);
  if (!values) return undefined;
  const { p, m, id } = values;
  if (typeof id !== "string" || id.length === 0) return undefined;
  if (p !== null && typeof p !== "number") return undefined;
  if (m !== null && typeof m !== "string") return undefined;
  let lastMessageAt: Date | null = null;
  if (m !== null) {
    const parsed = new Date(m);
    if (Number.isNaN(parsed.getTime())) return undefined;
    lastMessageAt = parsed;
  }
  return { priority: p, lastMessageAt, id };
}

/**
 * One cursor page of the inbox (Phase C5). Fetches `limit + 1` rows to learn
 * whether a next page exists, trims to `limit`, and returns the opaque cursor
 * for the last row. `since` remains accepted for backwards compatibility.
 */
export async function listInboxPage({
  userId,
  view = "needs_reply",
  since,
  cursor,
  limit = DEFAULT_PAGE_LIMIT,
}: {
  userId: string;
  view?: InboxView;
  since?: string | null;
  cursor?: string | null;
  limit?: number;
}): Promise<{ items: InboxItem[]; pagination: PaginationMeta }> {
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), MAX_INBOX_LIMIT);
  const after = decodeInboxCursor(cursor);
  const rows = await fetchInboxRows({
    userId,
    view,
    since,
    ...(after ? { after } : {}),
    limit: bounded + 1,
  });
  const { page, pagination } = buildPage({
    rows,
    limit: bounded,
    scope: INBOX_CURSOR_SCOPE,
    cursorOf: inboxCursorOf,
  });
  const items = await hydrateInbox(userId, view, page);
  return { items, pagination };
}

async function fetchInboxRows({
  userId,
  view,
  since,
  after,
  limit,
}: {
  userId: string;
  view: InboxView;
  since?: string | null;
  after?: InboxCursor;
  limit: number;
}): Promise<InboxThreadRow[]> {
  const now = new Date();
  const settings = await getCalendarSettings(userId);
  const endOfDay = endOfLocalDay(now, settings?.timezone ?? "UTC");

  let sinceDate: Date | undefined;
  if (since) {
    const parsed = new Date(since);
    if (!Number.isNaN(parsed.getTime())) sinceDate = parsed;
  }

  return threadRepository.listInbox({
    userId,
    view,
    now,
    endOfDay,
    ...(sinceDate ? { since: sinceDate } : {}),
    ...(after ? { after } : {}),
    limit,
  });
}

async function hydrateInbox(
  userId: string,
  view: InboxView,
  rows: InboxThreadRow[],
): Promise<InboxItem[]> {
  const threadIds = rows.map((row) => row.thread.id);
  if (threadIds.length === 0) return [];

  const [latestMessages, draftThreadIds, overnightThreadIds] = await Promise.all([
    messageRepository.latestByThreadIds(threadIds),
    draftRepository.listPendingThreadIds(threadIds),
    // 24/7 autopilot: which of these threads were auto-sent in the last day.
    autopilotRepository
      .listSentDecisionThreadIds(
        userId,
        threadIds,
        new Date(Date.now() - 24 * 60 * 60 * 1000),
      )
      .catch(() => []),
  ]);

  const latestByThread = new Map<string, (typeof latestMessages)[number]>();
  for (const message of latestMessages) {
    latestByThread.set(message.threadId, message);
  }
  const draftThreads = new Set(draftThreadIds);
  const overnightThreads = new Set(overnightThreadIds);

  // Resolve friendly names for known senders (the mirror only stores addresses).
  const fromAddrs = Array.from(
    new Set(
      rows
        .map(({ thread }) => latestByThread.get(thread.id)?.fromAddr)
        .filter((addr): addr is string => Boolean(addr)),
    ),
  );
  const nameByEmail = new Map<string, string>();
  const profileByEmail = new Map<
    string,
    { category: string; coldEmailScore: number }
  >();
  if (fromAddrs.length > 0) {
    const [known, profiles] = await Promise.all([
      contactRepository.listNamesByEmails(userId, fromAddrs),
      senderProfileRepository.listByEmails(userId, fromAddrs),
    ]);
    for (const contact of known) {
      if (contact.name) nameByEmail.set(contact.email.toLowerCase(), contact.name);
    }
    for (const profile of profiles) {
      profileByEmail.set(profile.email.toLowerCase(), {
        category: profile.category,
        coldEmailScore: profile.coldEmailScore,
      });
    }
  }

  return rows.map(({ thread, state }) => {
    const latest = latestByThread.get(thread.id);
    const profile = latest?.fromAddr
      ? profileByEmail.get(latest.fromAddr.toLowerCase())
      : undefined;
    return {
      threadId: thread.id,
      subject: thread.subject,
      from: latest?.fromAddr ?? null,
      fromName: latest?.fromAddr
        ? (nameByEmail.get(latest.fromAddr.toLowerCase()) ?? null)
        : null,
      snippet: latest?.snippet ?? latest?.bodyText?.slice(0, 160) ?? null,
      category: state?.category ?? null,
      priority: state?.priority ?? 0,
      action: state?.action ?? null,
      isUnread: thread.isUnread,
      lastMessageAt: thread.lastMessageAt
        ? thread.lastMessageAt.toISOString()
        : null,
      hasPendingDraft: draftThreads.has(thread.id),
      senderCategory: profile?.category ?? null,
      isColdEmail: (profile?.coldEmailScore ?? 0) >= 70,
      replyStatus: state?.replyStatus ?? null,
      handledOvernight: overnightThreads.has(thread.id),
      bucket: view,
    };
  });
}

export async function getThreadDetail({
  userId,
  threadId,
}: {
  userId: string;
  threadId: string;
}): Promise<ThreadDetail | null> {
  const thread = await threadRepository.findByIdForUser(userId, threadId);
  if (!thread) return null;

  const { getLatestMeetingForThread, getThreadProposal } = await import(
    "@/lib/calendar/booking"
  );

  const [history, state, draft, proposal, meeting] = await Promise.all([
    messageRepository.listByThread(threadId),
    threadStateRepository.findByThreadId(threadId),
    draftRepository.findPendingByThread(threadId),
    getThreadProposal(threadId),
    getLatestMeetingForThread(threadId),
  ]);

  // Sender intelligence for the header (category, cold score, unsubscribe).
  const senderEmail = [...history]
    .reverse()
    .find((message) => message.direction === "inbound")?.fromAddr;
  const senderProfile = senderEmail
    ? await senderProfileRepository.findByEmail(userId, senderEmail)
    : undefined;

  return {
    thread: {
      id: thread.id,
      subject: thread.subject,
      gmailThreadId: thread.gmailThreadId,
      isUnread: thread.isUnread,
      lastMessageAt: thread.lastMessageAt
        ? thread.lastMessageAt.toISOString()
        : null,
    },
    state: state
      ? {
          category: state.category,
          priority: state.priority,
          action: state.action,
          reason: state.reason ?? null,
          replyStatus: state.replyStatus ?? null,
        }
      : null,
    senderProfile: senderProfile
      ? {
          email: senderProfile.email,
          category: senderProfile.category,
          coldEmailScore: senderProfile.coldEmailScore,
          status: senderProfile.status,
          unsubscribeMethod: senderProfile.unsubscribeMethod,
        }
      : null,
    canSummarize: history.length >= MIN_MESSAGES_FOR_SUMMARY,
    messages: history.map((message) => ({
      id: message.id,
      direction: message.direction,
      from: message.fromAddr,
      to: message.toAddr,
      subject: message.subject,
      bodyText: message.bodyText,
      sentAt: message.sentAt ? message.sentAt.toISOString() : null,
    })),
    draft: draft
      ? {
          id: draft.id,
          body: draft.body,
          editedBody: draft.editedBody,
          status: draft.status,
        }
      : null,
    proposal,
    meeting: meeting
      ? {
          id: meeting.id,
          startAt: meeting.startAt ? meeting.startAt.toISOString() : null,
          endAt: meeting.endAt ? meeting.endAt.toISOString() : null,
          meetLink: meeting.meetLink,
          status: meeting.status,
        }
      : null,
  };
}

/**
 * Sends an approved draft. `editedBody` (when present) is what actually goes
 * out and is stored on the draft. Idempotent on the draft id.
 */
export async function approveDraft({
  userId,
  draftId,
  editedBody,
  transport,
}: {
  userId: string;
  draftId: string;
  editedBody?: string | null;
  /** Test seam; defaults to the real Gmail transport. */
  transport?: import("@/lib/gmail/client").GmailTransport;
}): Promise<{ sent: boolean; deduped: boolean } | null> {
  const draft = await draftRepository.findByIdForUser(userId, draftId);
  if (!draft) return null;
  if (draft.status === "sent") return { sent: true, deduped: true };
  if (draft.status === "discarded") return null;

  const thread = await threadRepository.findByIdForUser(userId, draft.threadId);
  if (!thread) return null;

  const mailbox = await mailboxRepository.findById(thread.mailboxId);
  if (!mailbox) return null;

  const inbound = await messageRepository.latestInboundByThreadId(thread.id);

  const body = (editedBody ?? draft.body).trim();
  const recipient = inbound?.fromAddr;
  if (!recipient) throw new Error("Thread has no inbound sender to reply to.");

  const { sendEmail } = await import("@/lib/gmail/send");

  const result = await sendEmail({
    userId,
    email: {
      from: mailbox.email,
      to: [recipient],
      subject: thread.subject ? `Re: ${thread.subject}` : "Re:",
      text: body,
    },
    gmailThreadId: thread.gmailThreadId,
    idempotencyKey: `draft:${draft.id}`,
    transport,
  });

  if (result.gmailMessageId) {
    await messageRepository.insert({
      id: nanoid(),
      threadId: thread.id,
      gmailMessageId: result.gmailMessageId,
      direction: "outbound",
      fromAddr: mailbox.email,
      toAddr: [recipient],
      subject: thread.subject ? `Re: ${thread.subject}` : "Re:",
      bodyText: body,
      sentAt: new Date(),
    });
  }

  await draftRepository.markSent({
    draftId: draft.id,
    sentBy: "user",
    editedBody: editedBody ?? draft.editedBody,
    decidedAt: new Date(),
  });

  // Learn the durable preference from the edit, after the response. Best-effort:
  // a memory failure must never affect a send that already succeeded.
  if (inbound?.bodyText) {
    const incoming = inbound.bodyText;
    deferMemoryLearning(() =>
      learnFromDraftEdit({
        userId,
        senderEmail: recipient,
        incoming,
        draft: draft.body,
        sent: body,
        sourceDraftId: draft.id,
        sourceThreadId: thread.id,
      }),
    );
  }

  return { sent: true, deduped: result.deduped };
}

/**
 * Run post-response work without blocking the request. Uses Next's `after()`
 * when inside a request scope and falls back to a detached promise otherwise
 * (scripts/tests), so callers never wait on memory extraction.
 */
function deferMemoryLearning(task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch {
    void task().catch(() => {
      // Extraction is best-effort; swallow so a detached rejection is silent.
    });
  }
}

export async function discardDraft({
  userId,
  draftId,
}: {
  userId: string;
  draftId: string;
}): Promise<boolean> {
  return draftRepository.discardForUser({ userId, draftId, now: new Date() });
}

const DRAFT_REGEN_GRAPH: import("@/lib/engine/flow").FlowGraph = {
  nodes: [
    { id: "l", type: "load-context" },
    { id: "d", type: "draft-reply" },
  ],
  edges: [{ from: "l", to: "d" }],
};

/** Re-runs context + drafting for a thread, updating its pending draft. */
export async function regenerateDraft({
  userId,
  threadId,
}: {
  userId: string;
  threadId: string;
}): Promise<{ draftId: string; body: string } | null> {
  const thread = await threadRepository.findIdForUser(userId, threadId);
  if (!thread) return null;

  const [{ seedDefaultFlows }, { runFlow }] = await Promise.all([
    import("@/lib/engine/flow"),
    import("@/lib/engine/run"),
  ]);
  const flow = await seedDefaultFlows(userId);
  const runId = nanoid();
  await flowRunRepository.insert({
    id: runId,
    userId,
    flowId: flow.id,
    triggerKind: "manual_regenerate",
    status: "running",
    state: { trigger: { threadId } },
  });

  const result = await runFlow({
    runId,
    userId,
    graph: DRAFT_REGEN_GRAPH,
    trigger: { threadId },
  });

  if (result.status !== "completed") return null;
  const draftId = result.trace
    .map((entry) => entry.output)
    .find(
      (output): output is { draftId: string; body: string } =>
        typeof output === "object" &&
        output !== null &&
        "draftId" in output,
    );
  return draftId ?? null;
}

/** Manual "Sync now": enqueue a mailbox sync for the user's mailbox and kick it. */
export async function syncInbox(userId: string): Promise<{
  accepted: boolean;
  mailboxId: string | null;
}> {
  const mailbox = await mailboxRepository.findFirstIdForUser(userId);
  if (!mailbox) return { accepted: false, mailboxId: null };

  const [{ enqueueJob }, { JOB_KIND_MAILBOX_SYNC }, { kickDrain }] =
    await Promise.all([
      import("@/lib/queue/queue"),
      import("@/lib/email-operator/job-kinds"),
      import("@/lib/email-operator/drain"),
    ]);

  // `mailbox_sync` first pulls new mail into the mirror, then enqueues the
  // triage pass. Enqueuing `inbound_email` directly (as this used to) only
  // re-processed threads that a previous sync had already mirrored.
  await enqueueJob(pool, userId, {
    kind: JOB_KIND_MAILBOX_SYNC,
    laneKey: `mailbox:${mailbox.id}`,
    payload: { mailboxId: mailbox.id },
    sourceEventId: `manual:${mailbox.id}:${Date.now()}`,
  });

  // Best-effort immediate drain; the daily cron is the safety net.
  await kickDrain("manual-sync").catch((error) => {
    console.warn("[inbox/sync] kick drain failed", error);
  });

  return { accepted: true, mailboxId: mailbox.id };
}
