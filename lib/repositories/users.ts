import "server-only";

import { eq } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { user } from "@/lib/db/schema";

/**
 * Persistence for the Better Auth `user` table. Only the existence probe the
 * session guard needs — Better Auth owns every other access to this table.
 */

export class UserRepository {
  constructor(private readonly database: Database = db) {}

  async existsById(userId: string): Promise<boolean> {
    const rows = await this.database
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return Boolean(rows[0]);
  }

  async findNameById(userId: string): Promise<string | null> {
    const rows = await this.database
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return rows[0]?.name ?? null;
  }

  /** Set the display name (onboarding profile step). */
  async updateName(input: {
    userId: string;
    name: string;
    now: Date;
  }): Promise<void> {
    await this.database
      .update(user)
      .set({ name: input.name, updatedAt: input.now })
      .where(eq(user.id, input.userId));
  }
}

export const userRepository = new UserRepository();
