import "server-only";

import { and, count, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db, pool } from "@/lib/db";
import {
  contacts,
  drafts,
  flowRuns,
  mailboxes,
  messages,
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

/**
 * Inbox read/write service. The inbox renders from Postgres — triage already
 * wrote `thread_states`, so opening a view costs no model call.
 */

export type InboxView = "needs_you" | "waiting" | "handled";

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
};

export type ThreadDetail = {
  thread: {
    id: string;
    subject: string | null;
    gmailThreadId: string;
    isUnread: boolean;
    lastMessageAt: string | null;
  };
  state: { category: string | null; priority: number; action: string | null } | null;
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

function viewPredicate(view: InboxView) {
  switch (view) {
    case "waiting":
      return eq(threadStates.category, "awaiting_reply");
    case "handled":
      return inArray(threadStates.category, ["fyi", "invoice", "newsletter", "spam"]);
    case "needs_you":
    default:
      return or(
        isNull(threadStates.category),
        inArray(threadStates.category, ["needs_reply", "meeting_request"]),
        eq(threadStates.action, "handoff"),
      );
  }
}

/** Pure predicate mirroring `viewPredicate`, used to bucket counts in JS. */
export function matchesView(
  view: InboxView,
  state: { category: string | null; action: string | null },
): boolean {
  const { category, action } = state;
  switch (view) {
    case "waiting":
      return category === "awaiting_reply";
    case "handled":
      return (
        category === "fyi" ||
        category === "invoice" ||
        category === "newsletter" ||
        category === "spam"
      );
    case "needs_you":
    default:
      return (
        category === null ||
        category === "needs_reply" ||
        category === "meeting_request" ||
        action === "handoff"
      );
  }
}

export type InboxCounts = {
  needs_you: number;
  waiting: number;
  handled: number;
  unread: number;
};

/**
 * Sidebar badge counts. A mailbox can hold thousands of threads, so this
 * aggregates in SQL — grouping by the state triple transfers a handful of rows
 * instead of streaming every thread just to bucket it in JS.
 */
export async function getInboxCounts(userId: string): Promise<InboxCounts> {
  const rows = await db
    .select({
      category: threadStates.category,
      action: threadStates.action,
      isUnread: threads.isUnread,
      total: count(),
    })
    .from(threads)
    .leftJoin(threadStates, eq(threadStates.threadId, threads.id))
    .where(eq(threads.userId, userId))
    .groupBy(threadStates.category, threadStates.action, threads.isUnread);

  const counts: InboxCounts = {
    needs_you: 0,
    waiting: 0,
    handled: 0,
    unread: 0,
  };

  for (const row of rows) {
    const state = { category: row.category, action: row.action };
    const total = Number(row.total);
    if (matchesView("needs_you", state)) counts.needs_you += total;
    if (matchesView("waiting", state)) counts.waiting += total;
    if (matchesView("handled", state)) counts.handled += total;
    if (row.isUnread) counts.unread += total;
  }

  return counts;
}

export async function listInbox({
  userId,
  view = "needs_you",
  since,
  limit = 50,
}: {
  userId: string;
  view?: InboxView;
  since?: string | null;
  limit?: number;
}): Promise<InboxItem[]> {
  const conditions = [eq(threads.userId, userId), viewPredicate(view)];
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
      and(inArray(drafts.threadId, threadIds), eq(drafts.status, "pending")),
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
  if (fromAddrs.length > 0) {
    const known = await db
      .select({ email: contacts.email, name: contacts.name })
      .from(contacts)
      .where(and(eq(contacts.userId, userId), inArray(contacts.email, fromAddrs)));
    for (const contact of known) {
      if (contact.name) nameByEmail.set(contact.email.toLowerCase(), contact.name);
    }
  }

  return rows.map(({ thread, state }) => {
    const latest = latestByThread.get(thread.id);
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
      .where(and(eq(drafts.threadId, threadId), eq(drafts.status, "pending")))
      .limit(1),
    getThreadProposal(threadId),
    getLatestMeetingForThread(threadId),
  ]);

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
        }
      : null,
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
      editedBody: editedBody ?? draft.editedBody,
      decidedAt: new Date(),
    })
    .where(eq(drafts.id, draft.id));

  return { sent: true, deduped: result.deduped };
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
