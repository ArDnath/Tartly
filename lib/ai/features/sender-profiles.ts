import "server-only";

import { and, count, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import {
  NOISE_CATEGORIES,
  senderProfiles,
  type MessageUnsubscribeInfo,
  type SenderCategory,
  type SenderProfileStatus,
} from "@/lib/db/schema";
import {
  extractDomainFromEmail,
  isPublicEmailDomain,
} from "@/lib/ai/features/reply-memory";

/**
 * Sender profiles (Phase 2).
 *
 * One row per `(user, sender address)` holding what we know: category, cold /
 * marketing scores, and any advertised unsubscribe mechanism. The row is the
 * cache that makes "one cheap model call per *new* sender" true — a known
 * sender is read from here and never re-classified.
 */

export type SenderProfile = typeof senderProfiles.$inferSelect;

export function normalizeSenderEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Provider domain, or "" for a public webmail address (never a real org). */
export function senderDomain(email: string): string {
  const domain = extractDomainFromEmail(email);
  return isPublicEmailDomain(domain) ? "" : domain;
}

export async function getSenderProfile({
  userId,
  email,
}: {
  userId: string;
  email: string;
}): Promise<SenderProfile | null> {
  const normalized = normalizeSenderEmail(email);
  if (!normalized) return null;
  const rows = await db
    .select()
    .from(senderProfiles)
    .where(
      and(eq(senderProfiles.userId, userId), eq(senderProfiles.email, normalized)),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listSenderProfiles({
  userId,
  limit = 200,
  status,
}: {
  userId: string;
  limit?: number;
  status?: SenderProfileStatus;
}): Promise<SenderProfile[]> {
  const conditions = [eq(senderProfiles.userId, userId)];
  if (status) conditions.push(eq(senderProfiles.status, status));
  return db
    .select()
    .from(senderProfiles)
    .where(and(...conditions))
    .orderBy(desc(senderProfiles.lastSeenAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}

export type SenderProfilePatch = Partial<{
  domain: string;
  category: SenderCategory;
  confidence: number;
  coldEmailScore: number;
  marketingScore: number;
  unsubscribeUrl: string | null;
  unsubscribeMethod: string | null;
  status: SenderProfileStatus;
  modelEnriched: boolean;
}>;

/**
 * Create-or-update a profile. Only ever advances `modelEnriched` to true, and
 * bumps `lastSeenAt`, so a deterministic pass cannot wipe a model-enriched row
 * back to a guess.
 */
export async function upsertSenderProfile({
  userId,
  email,
  patch = {},
}: {
  userId: string;
  email: string;
  patch?: SenderProfilePatch;
}): Promise<SenderProfile> {
  const normalized = normalizeSenderEmail(email);
  const now = new Date();
  const inserted = await db
    .insert(senderProfiles)
    .values({
      id: nanoid(),
      userId,
      email: normalized,
      domain: patch.domain ?? senderDomain(normalized),
      category: patch.category ?? "Other",
      confidence: clampScore(patch.confidence),
      coldEmailScore: clampScore(patch.coldEmailScore),
      marketingScore: clampScore(patch.marketingScore),
      unsubscribeUrl: patch.unsubscribeUrl ?? null,
      unsubscribeMethod: patch.unsubscribeMethod ?? null,
      status: patch.status ?? "active",
      modelEnriched: patch.modelEnriched ?? false,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [senderProfiles.userId, senderProfiles.email],
      set: {
        ...(patch.domain !== undefined ? { domain: patch.domain } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.confidence !== undefined
          ? { confidence: clampScore(patch.confidence) }
          : {}),
        ...(patch.coldEmailScore !== undefined
          ? { coldEmailScore: clampScore(patch.coldEmailScore) }
          : {}),
        ...(patch.marketingScore !== undefined
          ? { marketingScore: clampScore(patch.marketingScore) }
          : {}),
        ...(patch.unsubscribeUrl !== undefined
          ? { unsubscribeUrl: patch.unsubscribeUrl }
          : {}),
        ...(patch.unsubscribeMethod !== undefined
          ? { unsubscribeMethod: patch.unsubscribeMethod }
          : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        // Never downgrade a model-enriched profile.
        ...(patch.modelEnriched === true ? { modelEnriched: true } : {}),
        lastSeenAt: now,
      },
    })
    .returning();
  return inserted[0]!;
}

export async function setSenderStatus({
  userId,
  id,
  status,
}: {
  userId: string;
  id: string;
  status: SenderProfileStatus;
}): Promise<boolean> {
  const updated = await db
    .update(senderProfiles)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(senderProfiles.id, id), eq(senderProfiles.userId, userId)))
    .returning({ id: senderProfiles.id });
  return updated.length > 0;
}

export async function deleteSenderProfile({
  userId,
  id,
}: {
  userId: string;
  id: string;
}): Promise<boolean> {
  const deleted = await db
    .delete(senderProfiles)
    .where(and(eq(senderProfiles.id, id), eq(senderProfiles.userId, userId)))
    .returning({ id: senderProfiles.id });
  return deleted.length > 0;
}

export type SenderCategoryCount = { category: SenderCategory; total: number };

export async function getSenderCategoryCounts(
  userId: string,
): Promise<SenderCategoryCount[]> {
  const rows = await db
    .select({ category: senderProfiles.category, total: count() })
    .from(senderProfiles)
    .where(eq(senderProfiles.userId, userId))
    .groupBy(senderProfiles.category);
  return rows.map((row) => ({
    category: row.category,
    total: Number(row.total),
  }));
}

/** True when a category counts as noise we may auto-archive. */
export function isNoiseCategory(category: SenderCategory): boolean {
  return NOISE_CATEGORIES.includes(category);
}

/**
 * Whether the user has ever *sent* to this address. This is the strongest
 * deterministic "known sender" signal, and it never needs a model call.
 */
export async function hasPriorOutboundTo({
  userId,
  email,
}: {
  userId: string;
  email: string;
}): Promise<boolean> {
  const normalized = normalizeSenderEmail(email);
  if (!normalized) return false;
  const result = await db.execute(sql`
    select 1
    from messages m
    join threads t on m.thread_id = t.id
    where t.user_id = ${userId}
      and m.direction = 'outbound'
      and m.to_addr @> ${JSON.stringify([normalized])}::jsonb
    limit 1
  `);
  return (result.rows?.length ?? 0) > 0;
}

export function clampScore(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Deterministic bulk-mail signal from stored headers (no model). */
export function marketingScoreFromHeaders(
  unsubscribe: MessageUnsubscribeInfo | null | undefined,
): number {
  if (!unsubscribe) return 0;
  let score = 0;
  if (unsubscribe.oneClick) score += 60;
  if (unsubscribe.url) score += 20;
  if (unsubscribe.mailto) score += 10;
  if (unsubscribe.listId) score += 20;
  if (unsubscribe.precedence && ["bulk", "list", "junk"].includes(unsubscribe.precedence)) {
    score += 20;
  }
  return clampScore(score);
}
