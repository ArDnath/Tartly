import "server-only";

import { and, eq } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { flows } from "@/lib/db/schema";

/** Persistence for `flows` rows read and refreshed by the engine. */

export type Flow = typeof flows.$inferSelect;
export type NewFlow = typeof flows.$inferInsert;

export class FlowRepository {
  constructor(private readonly database: Database = db) {}

  async findByNameForUser(
    userId: string,
    name: string,
  ): Promise<Flow | undefined> {
    const rows = await this.database
      .select()
      .from(flows)
      .where(and(eq(flows.userId, userId), eq(flows.name, name)))
      .limit(1);
    return rows[0];
  }

  async updateGraphById(
    id: string,
    graph: Record<string, unknown>,
  ): Promise<Flow | undefined> {
    const rows = await this.database
      .update(flows)
      .set({ graph })
      .where(eq(flows.id, id))
      .returning();
    return rows[0];
  }

  async insert(values: NewFlow): Promise<Flow> {
    const rows = await this.database.insert(flows).values(values).returning();
    return rows[0]!;
  }
}

export const flowRepository = new FlowRepository();
