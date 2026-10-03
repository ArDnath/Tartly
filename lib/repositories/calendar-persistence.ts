import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import {
  calendarSettings,
  drafts,
  flowRuns,
  meetings,
} from "@/lib/db/schema";

/**
 * Persistence for the calendar feature: the working-hours profile
 * (`calendar_settings`), booked `meetings`, and the proposal lookup that reads
 * the latest draft's run state.
 *
 * One method = one atomic storage operation. Slot selection, idempotency races
 * and DTO shaping stay in `lib/calendar/*`.
 */

export type CalendarSettings = typeof calendarSettings.$inferSelect;
export type NewCalendarSettings = typeof calendarSettings.$inferInsert;
export type CalendarMeeting = typeof meetings.$inferSelect;
export type NewCalendarMeeting = typeof meetings.$inferInsert;

export class CalendarPersistenceRepository {
  constructor(private readonly database: Database = db) {}

  /* ------------------------------ calendar_settings --------------------- */

  async findSettingsByUser(
    userId: string,
  ): Promise<CalendarSettings | undefined> {
    const rows = await this.database
      .select()
      .from(calendarSettings)
      .where(eq(calendarSettings.userId, userId))
      .limit(1);
    return rows[0];
  }

  async findSettingsTimezoneByUser(
    userId: string,
  ): Promise<string | undefined> {
    const rows = await this.database
      .select({ timezone: calendarSettings.timezone })
      .from(calendarSettings)
      .where(eq(calendarSettings.userId, userId))
      .limit(1);
    return rows[0]?.timezone;
  }

  async upsertSettings(input: {
    userId: string;
    values: Omit<NewCalendarSettings, "userId" | "updatedAt">;
  }): Promise<CalendarSettings> {
    const inserted = await this.database
      .insert(calendarSettings)
      .values({ userId: input.userId, ...input.values })
      .onConflictDoUpdate({
        target: calendarSettings.userId,
        set: { ...input.values, updatedAt: new Date() },
      })
      .returning();
    return inserted[0]!;
  }

  /* ---------------------------------- meetings -------------------------- */

  async findLatestMeetingByThread(
    threadId: string,
  ): Promise<CalendarMeeting | undefined> {
    const rows = await this.database
      .select()
      .from(meetings)
      .where(eq(meetings.threadId, threadId))
      .orderBy(desc(meetings.createdAt))
      .limit(1);
    return rows[0];
  }

  async listMeetingsForUser(
    userId: string,
    limit: number,
  ): Promise<CalendarMeeting[]> {
    return this.database
      .select()
      .from(meetings)
      .where(eq(meetings.userId, userId))
      .orderBy(desc(meetings.startAt))
      .limit(limit);
  }

  async cancelMeetingOwned(input: {
    userId: string;
    meetingId: string;
  }): Promise<CalendarMeeting | undefined> {
    const updated = await this.database
      .update(meetings)
      .set({ status: "cancelled" })
      .where(
        and(eq(meetings.id, input.meetingId), eq(meetings.userId, input.userId)),
      )
      .returning();
    return updated[0];
  }

  async rescheduleMeetingOwned(input: {
    userId: string;
    meetingId: string;
    startAt: Date;
    endAt: Date;
  }): Promise<CalendarMeeting | undefined> {
    const updated = await this.database
      .update(meetings)
      .set({ startAt: input.startAt, endAt: input.endAt, status: "confirmed" })
      .where(
        and(eq(meetings.id, input.meetingId), eq(meetings.userId, input.userId)),
      )
      .returning();
    return updated[0];
  }

  async insertMeeting(values: NewCalendarMeeting): Promise<CalendarMeeting> {
    const inserted = await this.database
      .insert(meetings)
      .values(values)
      .returning();
    return inserted[0]!;
  }

  async findMeetingByThreadAndProposal(input: {
    threadId: string;
    proposalId: string;
  }): Promise<CalendarMeeting | undefined> {
    const rows = await this.database
      .select()
      .from(meetings)
      .where(
        and(
          eq(meetings.threadId, input.threadId),
          eq(meetings.proposalId, input.proposalId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async insertProposalMeeting(
    values: NewCalendarMeeting,
  ): Promise<CalendarMeeting | undefined> {
    const inserted = await this.database
      .insert(meetings)
      .values(values)
      .onConflictDoNothing({
        target: [meetings.threadId, meetings.proposalId],
      })
      .returning();
    return inserted[0];
  }

  /* ------------------------------ proposal lookup ----------------------- */

  async findLatestDraftRunId(threadId: string): Promise<string | null> {
    const rows = await this.database
      .select({ runId: drafts.runId })
      .from(drafts)
      .where(eq(drafts.threadId, threadId))
      .orderBy(desc(drafts.createdAt))
      .limit(1);
    return rows[0]?.runId ?? null;
  }

  async findFlowRunState(
    runId: string,
  ): Promise<Record<string, unknown> | undefined> {
    const rows = await this.database
      .select({ state: flowRuns.state })
      .from(flowRuns)
      .where(eq(flowRuns.id, runId))
      .limit(1);
    return rows[0]?.state;
  }
}

export const calendarPersistenceRepository =
  new CalendarPersistenceRepository();
