import "server-only";

import { nanoid } from "nanoid";

import {
  senderProfileRepository,
  type NewSenderProfile,
  type SenderProfile,
} from "@/lib/repositories/sender-profiles";
import { messageRepository } from "@/lib/repositories/messages";
import {
  NOISE_CATEGORIES,
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

export type { SenderProfile };

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
  const profile = await senderProfileRepository.findByEmail(userId, normalized);
  return profile ?? null;
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
  return senderProfileRepository.list({
    userId,
    ...(status ? { status } : {}),
    limit: Math.min(Math.max(limit, 1), 500),
  });
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
  const values: NewSenderProfile = {
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
  };
  return senderProfileRepository.upsert({
    values,
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
  });
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
  return senderProfileRepository.setStatus({
    userId,
    id,
    status,
    now: new Date(),
  });
}

export async function deleteSenderProfile({
  userId,
  id,
}: {
  userId: string;
  id: string;
}): Promise<boolean> {
  return senderProfileRepository.deleteOwned({ userId, id });
}

export type SenderCategoryCount = { category: SenderCategory; total: number };

export async function getSenderCategoryCounts(
  userId: string,
): Promise<SenderCategoryCount[]> {
  return senderProfileRepository.countByCategory(userId);
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
  return messageRepository.hasPriorOutboundTo({ userId, email: normalized });
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
