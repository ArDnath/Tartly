import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { meetings } from "@/lib/db/schema";
import {
  createCalendarEvent,
  type CreatedEvent,
} from "@/lib/calendar/events";

export type MeetingRow = typeof meetings.$inferSelect;

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
  const existing = await db
    .select()
    .from(meetings)
    .where(
      and(eq(meetings.threadId, threadId), eq(meetings.proposalId, proposalId)),
    )
    .limit(1);
  if (existing[0]) return existing[0];

  const event = await createEvent({
    userId,
    summary: subject,
    startUtc,
    endUtc,
    timeZone,
    attendees,
    requestId: proposalId,
  });

  const inserted = await db
    .insert(meetings)
    .values({
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
    })
    .onConflictDoNothing({
      target: [meetings.threadId, meetings.proposalId],
    })
    .returning();

  if (inserted[0]) return inserted[0];

  // Lost a race with a concurrent run; return what the winner wrote.
  const raced = await db
    .select()
    .from(meetings)
    .where(
      and(eq(meetings.threadId, threadId), eq(meetings.proposalId, proposalId)),
    )
    .limit(1);
  return raced[0];
}
