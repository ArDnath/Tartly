import "server-only";

import { and, asc, desc, eq, isNull } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { agentChatMessage, agentChatThread } from "@/lib/db/schema";

/**
 * Persistence for the assistant chat (`agent_chat_threads` /
 * `agent_chat_messages`) (SKILL §1.1).
 *
 * One method = one atomic storage operation. Title derivation, DTO shaping and
 * the workspace-setup state machine stay in `lib/ai/chat-service.ts`.
 */

export type AgentChatThread = typeof agentChatThread.$inferSelect;
export type NewAgentChatThread = typeof agentChatThread.$inferInsert;
export type AgentChatMessage = typeof agentChatMessage.$inferSelect;
export type NewAgentChatMessage = typeof agentChatMessage.$inferInsert;

export class AgentChatRepository {
  constructor(private readonly database: Database = db) {}

  async listThreads(input: {
    userId: string;
    includeArchived: boolean;
  }): Promise<AgentChatThread[]> {
    return this.database
      .select()
      .from(agentChatThread)
      .where(
        input.includeArchived
          ? eq(agentChatThread.userId, input.userId)
          : and(
              eq(agentChatThread.userId, input.userId),
              isNull(agentChatThread.archivedAt),
            ),
      )
      .orderBy(desc(agentChatThread.updatedAt));
  }

  async insertThread(values: NewAgentChatThread): Promise<AgentChatThread> {
    const inserted = await this.database
      .insert(agentChatThread)
      .values(values)
      .returning();
    return inserted[0]!;
  }

  /** Insert that tolerates a concurrent duplicate (workspace-setup thread). */
  async insertThreadIfAbsent(
    values: NewAgentChatThread,
  ): Promise<AgentChatThread | undefined> {
    const inserted = await this.database
      .insert(agentChatThread)
      .values(values)
      .onConflictDoNothing()
      .returning();
    return inserted[0];
  }

  async findThreadForUser(
    userId: string,
    threadId: string,
  ): Promise<AgentChatThread | undefined> {
    const rows = await this.database
      .select()
      .from(agentChatThread)
      .where(
        and(eq(agentChatThread.id, threadId), eq(agentChatThread.userId, userId)),
      )
      .limit(1);
    return rows[0];
  }

  async findThreadById(threadId: string): Promise<AgentChatThread | undefined> {
    const rows = await this.database
      .select()
      .from(agentChatThread)
      .where(eq(agentChatThread.id, threadId))
      .limit(1);
    return rows[0];
  }

  async updateThreadTitle(
    userId: string,
    threadId: string,
    title: string | null,
  ): Promise<AgentChatThread | undefined> {
    const updated = await this.database
      .update(agentChatThread)
      .set({ title })
      .where(
        and(eq(agentChatThread.id, threadId), eq(agentChatThread.userId, userId)),
      )
      .returning();
    return updated[0];
  }

  async setThreadArchived(
    userId: string,
    threadId: string,
    archived: boolean,
    now: Date,
  ): Promise<AgentChatThread | undefined> {
    const updated = await this.database
      .update(agentChatThread)
      .set({ archivedAt: archived ? now : null })
      .where(
        and(eq(agentChatThread.id, threadId), eq(agentChatThread.userId, userId)),
      )
      .returning();
    return updated[0];
  }

  async deleteThreadForUser(userId: string, threadId: string): Promise<boolean> {
    const deleted = await this.database
      .delete(agentChatThread)
      .where(
        and(eq(agentChatThread.id, threadId), eq(agentChatThread.userId, userId)),
      )
      .returning({ id: agentChatThread.id });
    return deleted.length > 0;
  }

  async listMessages(threadId: string): Promise<AgentChatMessage[]> {
    return this.database
      .select()
      .from(agentChatMessage)
      .where(eq(agentChatMessage.threadId, threadId))
      .orderBy(asc(agentChatMessage.createdAt));
  }

  async insertMessage(values: NewAgentChatMessage): Promise<AgentChatMessage> {
    const inserted = await this.database
      .insert(agentChatMessage)
      .values(values)
      .returning();
    return inserted[0]!;
  }

  async touchThread(threadId: string, now: Date): Promise<void> {
    await this.database
      .update(agentChatThread)
      .set({ updatedAt: now, lastMessageAt: now })
      .where(eq(agentChatThread.id, threadId));
  }
}

export const agentChatRepository = new AgentChatRepository();
