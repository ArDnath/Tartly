import "server-only";

import {
  createMeetingForProposal,
  type MeetingEventCreator,
  type MeetingRow,
} from "@/lib/calendar/meetings";
import { DEFAULT_CALENDAR_SETTINGS, getCalendarSettings } from "@/lib/calendar/settings";
import { calendarPersistenceRepository } from "@/lib/repositories/calendar-persistence";
import { threadRepository } from "@/lib/repositories/threads";

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
  const runId = await calendarPersistenceRepository.findLatestDraftRunId(threadId);
  if (!runId) return null;

  const runState = await calendarPersistenceRepository.findFlowRunState(runId);

  const state = runState as RunState | undefined;
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
  const meeting = await calendarPersistenceRepository.findLatestMeetingByThread(
    threadId,
  );
  return meeting ?? null;
}

/** Hard ceiling on a single meetings page; keeps the read bounded. */
export const MAX_MEETINGS_LIMIT = 500;
export const DEFAULT_MEETINGS_LIMIT = 200;

export async function listMeetings(
  userId: string,
  limit: number = DEFAULT_MEETINGS_LIMIT,
): Promise<MeetingRow[]> {
  return calendarPersistenceRepository.listMeetingsForUser(userId, limit);
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

  const thread = await threadRepository.findByIdForUser(userId, threadId);
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
