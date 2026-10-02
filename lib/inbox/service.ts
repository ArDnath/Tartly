import "server-only";

import { and, count, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { after } from "next/server";

import { learnFromDraftEdit } from "@/lib/ai/features/reply-memory";
import { MIN_MESSAGES_FOR_SUMMARY } from "@/lib/ai/features/summarize-thread";
import { getCalendarSettings } from "@/lib/calendar/settings";
import { addUtcDays, getZonedParts, zonedTimeToUtc } from "@/lib/calendar/tz";
import { db, pool } from "@/lib/db";
import {
  contacts,
  drafts,
  flowRuns,
  mailboxes,
  messages,
  senderProfiles,
  threadStates,
  threads,
} from "@/lib/db/schema";
import {
  getLatestMeetingForThread,
  getThreadProposal,
  type MeetingProposal,
} from "@/lib/calendar/booking";
import { seedDefaultFlows, type FlowGraph } from "@/lib/engine/flow";
import { runFlow } from "@/lib/engine/run";
import { kickDrain } from "@/lib/email-operator/drain";
import { JOB_KIND_MAILBOX_SYNC } from "@/lib/email-operator/job-kinds";
import type { GmailTransport } from "@/lib/gmail/client";
import { sendEmail } from "@/lib/gmail/send";
import { enqueueJob } from "@/lib/queue/queue";
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
  proposal: MeetingProposal | null;
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
 * The one source of truth for bucketing, as a SQL `CASE` expression. Order is
 * the precedence ladder, so counts (grouped on this expression) and lists
 * (filtered on it) can never disagree.
 */
function bucketExpression({
  now,
  endOfDay,
}: {
  now: Date;
  endOfDay: Date;
}) {
  return sql<string>`case
    when ${threadStates.category} in ('needs_reply','meeting_request')
      or ${threadStates.action} = 'handoff'
      or ${threadStates.category} is null
      then 'needs_reply'
    when exists (
      select 1 from followup_enrollments fe
      where fe.thread_id = ${threads.id}
        and fe.status = 'active'
        and fe.next_eval_at <= ${endOfDay}
    ) then 'follow_up_today'
    when exists (
      select 1 from meetings mt
      where mt.thread_id = ${threads.id}
        and mt.start_at >= ${now}
    ) or (
      ${threadStates.category} = 'meeting_request'
      and exists (
        select 1 from meetings mt2
        where mt2.thread_id = ${threads.id} and mt2.status = 'proposed'
      )
    ) then 'meetings'
    when ${threadStates.category} = 'awaiting_reply'
      or ${threadStates.replyStatus} = 'awaiting_them'
      then 'waiting'
    when exists (
      select 1 from drafts d_ai
      where d_ai.thread_id = ${threads.id}
        and d_ai.sent_by = 'ai'
        and d_ai.status = 'sent'
        and d_ai.decided_at >= (${now}::timestamptz - interval '7 days')
        and d_ai.decided_at >= coalesce(
          (
            select max(mi.sent_at) from messages mi
            where mi.thread_id = ${threads.id} and mi.direction = 'inbound'
          ),
          '-infinity'::timestamptz
        )
    ) then 'ai_handled'
    else 'fyi'
  end`;
}

/**
 * Sidebar badge counts. Every bucket is counted with the same CASE expression
 * `listInbox` filters on, so a badge always equals the rows it links to.
 */
export async function getInboxCounts(userId: string): Promise<InboxCounts> {
  const now = new Date();
  const settings = await getCalendarSettings(userId);
  const endOfDay = endOfLocalDay(now, settings?.timezone ?? "UTC");
  const bucket = bucketExpression({ now, endOfDay });

  const [perBucket, unreadRows] = await Promise.all([
    Promise.all(
      INBOX_VIEWS.map(async (view) => {
        const rows = await db
          .select({ total: count() })
          .from(threads)
          .leftJoin(threadStates, eq(threadStates.threadId, threads.id))
          .where(and(eq(threads.userId, userId), sql`${bucket} = ${view}`));
        return [view, Number(rows[0]?.total ?? 0)] as const;
      }),
    ),
    db
      .select({ total: count() })
      .from(threads)
      .where(and(eq(threads.userId, userId), eq(threads.isUnread, true))),
  ]);

  const counts: InboxCounts = {
    needs_reply: 0,
    follow_up_today: 0,
    meetings: 0,
    waiting: 0,
    ai_handled: 0,
    fyi: 0,
    unread: Number(unreadRows[0]?.total ?? 0),
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
  const now = new Date();
  const settings = await getCalendarSettings(userId);
  const endOfDay = endOfLocalDay(now, settings?.timezone ?? "UTC");
  const conditions = [
    eq(threads.userId, userId),
    sql`${bucketExpression({ now, endOfDay })} = ${view}`,
  ];
  if (since) {
    const sinceDate = new Date(since);
    if (!Number.isNaN(sinceDate.getTime())) {
      conditions.push(gt(threads.lastMessageAt, sinceDate));
    }
  }

  const rows = await db
    .select({
      thread: threads,
      state: threadStates,
    })
    .from(threads)
    .leftJoin(threadStates, eq(threadStates.threadId, threads.id))
    .where(and(...conditions))
    .orderBy(desc(threadStates.priority), desc(threads.lastMessageAt))
    .limit(Math.min(limit, 100));

  const threadIds = rows.map((row) => row.thread.id);
  if (threadIds.length === 0) return [];

  // Only the newest message per thread feeds the row. `DISTINCT ON` lets
  // Postgres return one row per thread instead of streaming the whole history
  // so JS can throw all but the last away.
  const latestMessages = await db
    .selectDistinctOn([messages.threadId])
    .from(messages)
    .where(inArray(messages.threadId, threadIds))
    .orderBy(messages.threadId, desc(messages.sentAt));

  const latestByThread = new Map<string, (typeof latestMessages)[number]>();
  for (const message of latestMessages) {
    latestByThread.set(message.threadId, message);
  }

  const pendingDrafts = await db
    .select({ threadId: drafts.threadId })
    .from(drafts)
    .where(
      and(
        inArray(drafts.threadId, threadIds),
        eq(drafts.status, "pending"),
        // A draft below the user's confidence threshold is stored but hidden.
        eq(drafts.suppressed, false),
      ),
    );
  const draftThreads = new Set(pendingDrafts.map((row) => row.threadId));

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
      db
        .select({ email: contacts.email, name: contacts.name })
        .from(contacts)
        .where(and(eq(contacts.userId, userId), inArray(contacts.email, fromAddrs))),
      db
        .select({
          email: senderProfiles.email,
          category: senderProfiles.category,
          coldEmailScore: senderProfiles.coldEmailScore,
        })
        .from(senderProfiles)
        .where(
          and(eq(senderProfiles.userId, userId), inArray(senderProfiles.email, fromAddrs)),
        ),
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
  const threadRows = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId)))
    .limit(1);
  const thread = threadRows[0];
  if (!thread) return null;

  const [history, stateRows, draftRows, proposal, meeting] = await Promise.all([
    db
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(messages.sentAt),
    db
      .select()
      .from(threadStates)
      .where(eq(threadStates.threadId, threadId))
      .limit(1),
    db
      .select()
      .from(drafts)
      .where(
        and(
          eq(drafts.threadId, threadId),
          eq(drafts.status, "pending"),
          // Below-threshold drafts are stored but not surfaced as actionable.
          eq(drafts.suppressed, false),
        ),
      )
      .limit(1),
    getThreadProposal(threadId),
    getLatestMeetingForThread(threadId),
  ]);

  // Sender intelligence for the header (category, cold score, unsubscribe).
  const senderEmail = [...history]
    .reverse()
    .find((message) => message.direction === "inbound")?.fromAddr;
  const senderProfileRows = senderEmail
    ? await db
        .select({
          email: senderProfiles.email,
          category: senderProfiles.category,
          coldEmailScore: senderProfiles.coldEmailScore,
          status: senderProfiles.status,
          unsubscribeMethod: senderProfiles.unsubscribeMethod,
        })
        .from(senderProfiles)
        .where(
          and(
            eq(senderProfiles.userId, userId),
            eq(senderProfiles.email, senderEmail.toLowerCase()),
          ),
        )
        .limit(1)
    : [];

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
    state: stateRows[0]
      ? {
          category: stateRows[0].category,
          priority: stateRows[0].priority,
          action: stateRows[0].action,
          reason: stateRows[0].reason ?? null,
          replyStatus: stateRows[0].replyStatus ?? null,
        }
      : null,
    senderProfile: senderProfileRows[0] ?? null,
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
    draft: draftRows[0]
      ? {
          id: draftRows[0].id,
          body: draftRows[0].body,
          editedBody: draftRows[0].editedBody,
          status: draftRows[0].status,
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
  transport?: GmailTransport;
}): Promise<{ sent: boolean; deduped: boolean } | null> {
  const rows = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.id, draftId), eq(drafts.userId, userId)))
    .limit(1);
  const draft = rows[0];
  if (!draft) return null;
  if (draft.status === "sent") return { sent: true, deduped: true };
  if (draft.status === "discarded") return null;

  const threadRows = await db
    .select()
    .from(threads)
    .where(eq(threads.id, draft.threadId))
    .limit(1);
  const thread = threadRows[0];
  if (!thread) return null;

  const mailboxRows = await db
    .select()
    .from(mailboxes)
    .where(eq(mailboxes.id, thread.mailboxId))
    .limit(1);
  const mailbox = mailboxRows[0];
  if (!mailbox) return null;

  const inbound = (
    await db
      .select()
      .from(messages)
      .where(and(eq(messages.threadId, thread.id), eq(messages.direction, "inbound")))
      .orderBy(desc(messages.sentAt))
      .limit(1)
  )[0];

  const body = (editedBody ?? draft.body).trim();
  const recipient = inbound?.fromAddr;
  if (!recipient) throw new Error("Thread has no inbound sender to reply to.");

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
    await db
      .insert(messages)
      .values({
        id: nanoid(),
        threadId: thread.id,
        gmailMessageId: result.gmailMessageId,
        direction: "outbound",
        fromAddr: mailbox.email,
        toAddr: [recipient],
        subject: thread.subject ? `Re: ${thread.subject}` : "Re:",
        bodyText: body,
        sentAt: new Date(),
      })
      .onConflictDoNothing({ target: messages.gmailMessageId });
  }

  await db
    .update(drafts)
    .set({
      status: "sent",
      sentBy: "user",
      editedBody: editedBody ?? draft.editedBody,
      decidedAt: new Date(),
    })
    .where(eq(drafts.id, draft.id));

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
  const updated = await db
    .update(drafts)
    .set({ status: "discarded", decidedAt: new Date() })
    .where(and(eq(drafts.id, draftId), eq(drafts.userId, userId)))
    .returning({ id: drafts.id });
  return updated.length > 0;
}

const DRAFT_REGEN_GRAPH: FlowGraph = {
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
  const threadRows = await db
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId)))
    .limit(1);
  if (!threadRows[0]) return null;

  const flow = await seedDefaultFlows(userId);
  const runId = nanoid();
  await db.insert(flowRuns).values({
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
  const mailboxRows = await db
    .select({ id: mailboxes.id })
    .from(mailboxes)
    .where(eq(mailboxes.userId, userId))
    .limit(1);
  const mailbox = mailboxRows[0];
  if (!mailbox) return { accepted: false, mailboxId: null };

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
