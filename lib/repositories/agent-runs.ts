import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { agentChatMessage, agentChatThread, agentRuns } from "@/lib/db/schema";

/**
 * Persistence for agent execution records (`agent_runs`) and the
 * conversation-scoped reads the persistence service composes with
 * `agentChatRepository`.
 *
 * One method = one atomic storage operation. Trace accumulation, message DTO
 * shaping and the ownership error stay in `lib/agent/persistence.ts`.
 */

export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
export type AgentChatMessageRow = typeof agentChatMessage.$inferSelect;

export class AgentRunRepository {
  constructor(private readonly database: Database = db) {}

  async insertRun(values: NewAgentRun): Promise<void> {
    await this.database.insert(agentRuns).values(values);
  }

  async updateRunById(input: {
    runId: string;
    values: Partial<NewAgentRun>;
  }): Promise<void> {
    await this.database
      .update(agentRuns)
      .set(input.values)
      .where(eq(agentRuns.id, input.runId));
  }

  /** Id-only ownership probe for a conversation. */
  async findThreadIdForUser(
    userId: string,
    threadId: string,
  ): Promise<{ id: string } | undefined> {
    const rows = await this.database
      .select({ id: agentChatThread.id })
      .from(agentChatThread)
      .where(
        and(
          eq(agentChatThread.id, threadId),
          eq(agentChatThread.userId, userId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async listRecentMessagesByThread(
    threadId: string,
    limit: number,
  ): Promise<AgentChatMessageRow[]> {
    return this.database
      .select()
      .from(agentChatMessage)
      .where(eq(agentChatMessage.threadId, threadId))
      .orderBy(desc(agentChatMessage.createdAt))
      .limit(limit);
  }

  async updateCompactionSummary(
    threadId: string,
    summary: string,
  ): Promise<void> {
    await this.database
      .update(agentChatThread)
      .set({ compactionSummary: summary })
      .where(eq(agentChatThread.id, threadId));
  }
}

export const agentRunsRepository = new AgentRunRepository();
