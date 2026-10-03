import "server-only";

import { and, eq, lt } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { eventLog } from "@/lib/db/schema";

/** Persistence for the inbound provider-event dedupe log. */

export type EventLog = typeof eventLog.$inferSelect;
export type NewEventLog = typeof eventLog.$inferInsert;

export class EventLogRepository {
  constructor(private readonly database: Database = db) {}

  /**
   * Records an event, ignoring a redelivery of the same `(userId, externalId)`.
   * Returns the new row id when this caller won, or undefined when it already
   * existed.
   */
  async insertIfAbsent(
    values: NewEventLog,
  ): Promise<{ id: string } | undefined> {
    const inserted = await this.database
      .insert(eventLog)
      .values(values)
      .onConflictDoNothing({
        target: [eventLog.userId, eventLog.externalId],
      })
      .returning({ id: eventLog.id });
    return inserted[0];
  }

  async findIdByExternalId(input: {
    userId: string;
    externalId: string;
  }): Promise<{ id: string } | undefined> {
    const rows = await this.database
      .select({ id: eventLog.id })
      .from(eventLog)
      .where(
        and(
          eq(eventLog.userId, input.userId),
          eq(eventLog.externalId, input.externalId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async findById(eventId: string): Promise<EventLog | undefined> {
    const rows = await this.database
      .select()
      .from(eventLog)
      .where(eq(eventLog.id, eventId))
      .limit(1);
    return rows[0];
  }

  async markProcessed(eventId: string, processedAt: Date): Promise<void> {
    await this.database
      .update(eventLog)
      .set({ processedAt })
      .where(eq(eventLog.id, eventId));
  }

  /** Deletes dedupe rows older than `cutoff`; returns the deleted count. */
  async deleteBefore(cutoff: Date): Promise<number> {
    const deleted = await this.database
      .delete(eventLog)
      .where(lt(eventLog.createdAt, cutoff))
      .returning({ id: eventLog.id });
    return deleted.length;
  }
}

export const eventLogRepository = new EventLogRepository();
