import "dotenv/config";

import { eq, like } from "drizzle-orm";

import { db } from "../../lib/db";
import { user } from "../../lib/db/schema";

/**
 * Shared helpers for the email-operator phase tests. The repo's convention is
 * DB-backed smoke scripts run with `tsx` (see `scripts/onboarding-smoke.ts`);
 * these tests follow the same shape but are grouped per phase.
 */

let failures = 0;

export function assert(condition: unknown, label: string): void {
  if (!condition) {
    failures += 1;
    throw new Error(`FAILED: ${label}`);
  }
  console.log(`  ok  ${label}`);
}

export function section(name: string): void {
  console.log(`\n${name}:`);
}

export function getFailureCount(): number {
  return failures;
}

export function makeTestUserId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createTestUser(userId: string, name = "Operator Test") {
  await db.insert(user).values({
    id: userId,
    name,
    email: `${userId}@example.com`,
  });
  return userId;
}

export async function deleteTestUser(userId: string): Promise<void> {
  await db.delete(user).where(eq(user.id, userId));
}

/**
 * Removes rows left behind by a phase test that was killed mid-run (e.g. a
 * timeout or a hard crash). Every test user id is prefixed with `phase<n>-`;
 * foreign keys cascade, so deleting the user clears mailboxes, threads,
 * messages, runs and drafts too. Without this a stale globally-unique
 * `gmail_thread_id` from a crashed run collides with the next run and the whole
 * suite fails before it starts.
 */
export async function cleanupStaleTestUsers(): Promise<void> {
  await db.delete(user).where(like(user.id, "phase%"));
}
