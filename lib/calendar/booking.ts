import "server-only";

import { and, desc, eq } from "drizzle-orm";

import {
  createMeetingForProposal,
  type MeetingEventCreator,
  type MeetingRow,
} from "@/lib/calendar/meetings";
import { DEFAULT_CALENDAR_SETTINGS, getCalendarSettings } from "@/lib/calendar/settings";
import { db } from "@/lib/db";
import { drafts, flowRuns, meetings, threads } from "@/lib/db/schema";

type RunState = {
  proposalId?: string | null;
  slotInstants?: Array<{ startUtc: string; endUtc: string }>;
};

export type MeetingProposal = {
  proposalId: string;
  slots: Array<{ startUtc: string; endUtc: string; label: string | null }>;
};

/**
 * Reads the latest draft's run state to recover the proposed slots for a
 * thread. Proposals are not a table: they live on the run that produced them.
 */
export async function getThreadProposal(
  threadId: string,
): Promise<MeetingProposal | null> {
  const draftRows = await db
    .select({ runId: drafts.runId })
    .from(drafts)
    .where(eq(drafts.threadId, threadId))
    .orderBy(desc(drafts.createdAt))
    .limit(1);

  const runId = draftRows[0]?.runId;
  if (!runId) return null;

  const runRows = await db
    .select({ state: flowRuns.state })
    .from(flowRuns)
    .where(eq(flowRuns.id, runId))
    .limit(1);

  const state = runRows[0]?.state as RunState | undefined;
  if (!state?.proposalId || !Array.isArray(state.slotInstants)) return null;

  const options = (state as { options?: string[] }).options ?? [];
  return {
    proposalId: state.proposalId,
    slots: state.slotInstants.map((slot, index) => ({
      startUtc: slot.startUtc,
      endUtc: slot.endUtc,
      label: options[index] ?? null,
    })),
  };
}

export async function getLatestMeetingForThread(
  threadId: string,
): Promise<MeetingRow | null> {
  const rows = await db
    .select()
    .from(meetings)
    .where(eq(meetings.threadId, threadId))
    .orderBy(desc(meetings.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function listMeetings(userId: string): Promise<MeetingRow[]> {
  return db
    .select()
    .from(meetings)
    .where(eq(meetings.userId, userId))
    .orderBy(desc(meetings.startAt));
}

/**
 * Books one of a thread's proposed slots. Idempotent on the proposal, so
 * double-clicking "Book" cannot create two events.
 */
export async function bookSlot({
  userId,
  threadId,
  slotIndex,
  createEvent,
}: {
  userId: string;
  threadId: string;
  slotIndex: number;
  /** Test seam; defaults to the real Google Calendar creator. */
  createEvent?: MeetingEventCreator;
}): Promise<MeetingRow | null> {
  const proposal = await getThreadProposal(threadId);
  const slot = proposal?.slots[slotIndex];
  if (!proposal || !slot) return null;

  const threadRows = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId)))
    .limit(1);
  const thread = threadRows[0];
  if (!thread) return null;

  const settings = (await getCalendarSettings(userId)) ?? DEFAULT_CALENDAR_SETTINGS;

  return createMeetingForProposal({
    userId,
    threadId,
    proposalId: proposal.proposalId,
    subject: thread.subject ?? "Meeting",
    startUtc: new Date(slot.startUtc),
    endUtc: new Date(slot.endUtc),
    timeZone: settings.timezone,
    createEvent,
  });
}
