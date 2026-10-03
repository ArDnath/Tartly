import "server-only";

import { and, desc, eq, isNull, or } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { threadStates, threads } from "@/lib/db/schema";

/** Persistence for the inbound-email handler's thread selection. */

export class InboundEmailRepository {
  constructor(private readonly database: Database = db) {}

  /**
   * Unread or never-triaged threads of a mailbox, newest first. The caller has
   * already verified mailbox ownership.
   */
  async listTriageCandidates(input: {
    mailboxId: string;
    limit: number;
  }): Promise<Array<{ id: string }>> {
    return this.database
      .select({ id: threads.id })
      .from(threads)
      .leftJoin(threadStates, eq(threadStates.threadId, threads.id))
      .where(
        and(
          eq(threads.mailboxId, input.mailboxId),
          or(eq(threads.isUnread, true), isNull(threadStates.threadId)),
        ),
      )
      .orderBy(desc(threads.lastMessageAt))
      .limit(input.limit);
  }
}

export const inboundEmailRepository = new InboundEmailRepository();
