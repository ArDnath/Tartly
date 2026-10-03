import "server-only";

import { nanoid } from "nanoid";

import {
  createCalendarEvent,
  type CreatedEvent,
} from "@/lib/calendar/events";
import {
  calendarPersistenceRepository,
  type CalendarMeeting,
} from "@/lib/repositories/calendar-persistence";

export type MeetingRow = CalendarMeeting;

export type MeetingEventCreator = (args: {
  userId: string;
  summary: string;
  startUtc: Date;
  endUtc: Date;
  timeZone: string;
  attendees?: string[];
  requestId?: string;
}) => Promise<CreatedEvent>;

/**
 * Creates (or returns) the meeting for a proposal.
 *
 * Idempotent on `(threadId, proposalId)`: a re-run of the flow — or a retried
 * drain — updates the same event instead of booking a duplicate. The event
 * creator is injectable so the idempotency logic is testable without Google.
 */
export async function createMeetingForProposal({
  userId,
  threadId,
  proposalId,
  subject,
  startUtc,
  endUtc,
  timeZone,
  attendees,
  createEvent = createCalendarEvent,
}: {
  userId: string;
  threadId: string;
  proposalId: string;
  subject: string;
  startUtc: Date;
  endUtc: Date;
  timeZone: string;
  attendees?: string[];
  createEvent?: MeetingEventCreator;
}): Promise<MeetingRow> {
  const existing = await calendarPersistenceRepository.findMeetingByThreadAndProposal({
    threadId,
    proposalId,
  });
  if (existing) return existing;

  const event = await createEvent({
    userId,
    summary: subject,
    startUtc,
    endUtc,
    timeZone,
    attendees,
    requestId: proposalId,
  });

  const inserted = await calendarPersistenceRepository.insertProposalMeeting({
    id: nanoid(),
    userId,
    threadId,
    calendarEventId: event.id || null,
    proposalId,
    subject,
    startAt: startUtc,
    endAt: endUtc,
    meetLink: event.meetLink,
    status: "confirmed",
  });

  if (inserted) return inserted;

  // Lost a race with a concurrent run; return what the winner wrote.
  const raced = await calendarPersistenceRepository.findMeetingByThreadAndProposal({
    threadId,
    proposalId,
  });
  return raced as MeetingRow;
}
