import "server-only";

import { eq } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { onboardingState } from "@/lib/db/schema";

/**
 * Persistence for the onboarding state machine row (`onboarding_state`).
 *
 * One method = one atomic storage operation. Status transitions, reversible
 * history math and snapshot shaping stay in `lib/onboarding/server.ts`.
 */

export type OnboardingState = typeof onboardingState.$inferSelect;
export type NewOnboardingState = typeof onboardingState.$inferInsert;

export class OnboardingRepository {
  constructor(private readonly database: Database = db) {}

  async findByUser(userId: string): Promise<OnboardingState | undefined> {
    const rows = await this.database
      .select()
      .from(onboardingState)
      .where(eq(onboardingState.userId, userId))
      .limit(1);
    return rows[0];
  }

  async insertIfAbsent(
    values: NewOnboardingState,
  ): Promise<OnboardingState | undefined> {
    const inserted = await this.database
      .insert(onboardingState)
      .values(values)
      .onConflictDoNothing()
      .returning();
    return inserted[0];
  }

  async updateByUser(
    userId: string,
    patch: Partial<OnboardingState>,
  ): Promise<OnboardingState> {
    const updated = await this.database
      .update(onboardingState)
      .set(patch)
      .where(eq(onboardingState.userId, userId))
      .returning();
    return updated[0]!;
  }
}

export const onboardingRepository = new OnboardingRepository();
