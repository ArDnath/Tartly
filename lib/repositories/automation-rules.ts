import "server-only";

import { and, asc, count, desc, eq, gte } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { automationRules, ruleExecutions } from "@/lib/db/schema";

/**
 * Persistence for the plain-English rules engine (`automation_rules` /
 * `rule_executions`) (SKILL §1.1).
 *
 * One method = one atomic storage operation. Evaluation, action application and
 * reason strings stay in `lib/ai/features/rules.ts`.
 */

export type AutomationRule = typeof automationRules.$inferSelect;
export type NewAutomationRule = typeof automationRules.$inferInsert;
export type RuleExecution = typeof ruleExecutions.$inferSelect;
export type NewRuleExecution = typeof ruleExecutions.$inferInsert;

export class AutomationRuleRepository {
  constructor(private readonly database: Database = db) {}

  async listRules(userId: string, limit: number): Promise<AutomationRule[]> {
    return this.database
      .select()
      .from(automationRules)
      .where(eq(automationRules.userId, userId))
      .orderBy(asc(automationRules.priority), desc(automationRules.createdAt))
      .limit(limit);
  }

  async findRule(
    userId: string,
    id: string,
  ): Promise<AutomationRule | undefined> {
    const rows = await this.database
      .select()
      .from(automationRules)
      .where(and(eq(automationRules.id, id), eq(automationRules.userId, userId)))
      .limit(1);
    return rows[0];
  }

  async insertRule(values: NewAutomationRule): Promise<AutomationRule> {
    const inserted = await this.database
      .insert(automationRules)
      .values(values)
      .returning();
    return inserted[0]!;
  }

  async updateRule(input: {
    userId: string;
    id: string;
    patch: Partial<NewAutomationRule>;
    now: Date;
  }): Promise<boolean> {
    const updated = await this.database
      .update(automationRules)
      .set({ ...input.patch, updatedAt: input.now })
      .where(
        and(
          eq(automationRules.id, input.id),
          eq(automationRules.userId, input.userId),
        ),
      )
      .returning({ id: automationRules.id });
    return updated.length > 0;
  }

  async deleteRule(input: { userId: string; id: string }): Promise<boolean> {
    const deleted = await this.database
      .delete(automationRules)
      .where(
        and(
          eq(automationRules.id, input.id),
          eq(automationRules.userId, input.userId),
        ),
      )
      .returning({ id: automationRules.id });
    return deleted.length > 0;
  }

  async insertExecution(values: NewRuleExecution): Promise<void> {
    await this.database.insert(ruleExecutions).values(values);
  }

  /** Executions with the rule name, newest first (the "why" history UI). */
  async listExecutionsWithRuleName(
    userId: string,
    limit: number,
  ): Promise<Array<RuleExecution & { ruleName: string | null }>> {
    const rows = await this.database
      .select({ execution: ruleExecutions, ruleName: automationRules.name })
      .from(ruleExecutions)
      .leftJoin(automationRules, eq(ruleExecutions.ruleId, automationRules.id))
      .where(eq(ruleExecutions.userId, userId))
      .orderBy(desc(ruleExecutions.createdAt))
      .limit(limit);
    return rows.map((row) => ({ ...row.execution, ruleName: row.ruleName }));
  }

  async countAppliedSince(userId: string, since: Date): Promise<number> {
    const rows = await this.database
      .select({ n: count() })
      .from(ruleExecutions)
      .where(
        and(
          eq(ruleExecutions.userId, userId),
          eq(ruleExecutions.status, "applied"),
          gte(ruleExecutions.createdAt, since),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  }
}

export const automationRuleRepository = new AutomationRuleRepository();
