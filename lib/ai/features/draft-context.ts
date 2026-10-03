import "server-only";

import { searchKnowledge } from "@/lib/ai/features/knowledge";
import { selectReplyMemories } from "@/lib/ai/features/reply-memory";
import {
  assistantSettingsRepository,
  type NewAssistantSettings,
} from "@/lib/repositories/assistant-settings";
import { commitmentRepository } from "@/lib/repositories/commitments";
import { knowledgeRepository } from "@/lib/repositories/knowledge";
import { replyMemoryRepository } from "@/lib/repositories/reply-memory";
import type { WritingStyleProfile } from "@/lib/db/schema";
import { isAssistantKnowledgeEnabled, isAssistantMemoryEnabled, isAssistantVoiceEnabled } from "@/lib/env";

/**
 * Draft context (Phase 1 wiring).
 *
 * One place that assembles the personalization inputs — voice, memory,
 * knowledge — for both the engine's `draft-reply` step and the agent's
 * `draft_in_my_voice` tool. Everything here is bounded and has a deterministic
 * empty fallback, so drafting works with no model and no stored context.
 */

/** Bumped whenever the draft inputs/routing change, for attribution. */
export const DRAFT_PIPELINE_VERSION = "draft-v2";

export type ConfidenceLevel = "LOW" | "MEDIUM" | "HIGH";
export type DraftConfidenceSetting = "all" | "standard" | "high";
export type ColdEmailAction = "label" | "archive" | "none";

export type AssistantConfig = {
  voiceEnabled: boolean;
  memoryEnabled: boolean;
  knowledgeEnabled: boolean;
  draftConfidence: DraftConfidenceSetting;
  explicitWritingStyle: string | null;
  learnedWritingStyle: string | null;
  styleAnalyzedAt: Date | null;
  // Phase 2 sender intelligence.
  senderIntelEnabled: boolean;
  coldEmailAction: ColdEmailAction;
  autoArchiveNoise: boolean;
  // Phase 4 communication.
  meetingBriefsEnabled: boolean;
  digestFrequency: DigestFrequency;
  digestLastGeneratedAt: Date | null;
  // Morning briefing, commitments & auto-memory.
  briefingEnabled: boolean;
  briefingHour: number;
  commitmentsEnabled: boolean;
  memoryAutoExtract: boolean;
  /** 24/7 autopilot: show the overnight review block in the morning catch-up. */
  overnightReviewEnabled: boolean;
};

export type DigestFrequency = "off" | "daily" | "weekly";

export function normalizeDigestFrequency(value: unknown): DigestFrequency {
  return value === "daily" || value === "weekly" ? value : "off";
}

export const DEFAULT_ASSISTANT_CONFIG: AssistantConfig = {
  voiceEnabled: true,
  memoryEnabled: true,
  knowledgeEnabled: true,
  draftConfidence: "all",
  explicitWritingStyle: null,
  learnedWritingStyle: null,
  styleAnalyzedAt: null,
  senderIntelEnabled: true,
  coldEmailAction: "label",
  autoArchiveNoise: false,
  meetingBriefsEnabled: true,
  digestFrequency: "off",
  digestLastGeneratedAt: null,
  briefingEnabled: true,
  briefingHour: 8,
  commitmentsEnabled: true,
  memoryAutoExtract: false,
  overnightReviewEnabled: true,
};

export function normalizeColdEmailAction(value: unknown): ColdEmailAction {
  return value === "archive" || value === "none" ? value : "label";
}

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};

/**
 * Whether a draft's reported confidence clears the user's minimum.
 * - `all`     → always shown (a missing confidence counts as LOW).
 * - `standard`→ MEDIUM or HIGH.
 * - `high`    → HIGH only.
 */
export function meetsConfidenceRequirement({
  draftConfidence,
  minimum,
}: {
  draftConfidence: ConfidenceLevel | null | undefined;
  minimum: DraftConfidenceSetting;
}): boolean {
  if (minimum === "all") return true;
  const required = minimum === "high" ? CONFIDENCE_RANK.HIGH : CONFIDENCE_RANK.MEDIUM;
  const actual = draftConfidence ? CONFIDENCE_RANK[draftConfidence] : -1;
  return actual >= required;
}

export function normalizeDraftConfidenceSetting(
  value: unknown,
): DraftConfidenceSetting {
  return value === "standard" || value === "high" ? value : "all";
}

export async function getAssistantSettings(
  userId: string,
): Promise<AssistantConfig> {
  const row = await assistantSettingsRepository.findByUser(userId);

  if (!row) return DEFAULT_ASSISTANT_CONFIG;

  return {
    voiceEnabled: row.voiceEnabled,
    memoryEnabled: row.memoryEnabled,
    knowledgeEnabled: row.knowledgeEnabled,
    draftConfidence: normalizeDraftConfidenceSetting(row.draftConfidence),
    explicitWritingStyle: row.explicitWritingStyle,
    learnedWritingStyle: row.learnedWritingStyle,
    styleAnalyzedAt: row.styleAnalyzedAt,
    senderIntelEnabled: row.senderIntelEnabled,
    coldEmailAction: normalizeColdEmailAction(row.coldEmailAction),
    autoArchiveNoise: row.autoArchiveNoise,
    meetingBriefsEnabled: row.meetingBriefsEnabled,
    digestFrequency: normalizeDigestFrequency(row.digestFrequency),
    digestLastGeneratedAt: row.digestLastGeneratedAt,
    briefingEnabled: row.briefingEnabled,
    briefingHour: normalizeBriefingHour(row.briefingHour),
    commitmentsEnabled: row.commitmentsEnabled,
    memoryAutoExtract: row.memoryAutoExtract,
    overnightReviewEnabled: row.overnightReviewEnabled,
  };
}

export function normalizeBriefingHour(value: unknown): number {
  const hour = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(hour)) return 8;
  return Math.min(Math.max(Math.trunc(hour), 0), 23);
}

export async function updateAssistantSettings(
  userId: string,
  patch: Partial<{
    voiceEnabled: boolean;
    memoryEnabled: boolean;
    knowledgeEnabled: boolean;
    draftConfidence: DraftConfidenceSetting;
    explicitWritingStyle: string | null;
    writingStyle: WritingStyleProfile | null;
    learnedWritingStyle: string | null;
    styleAnalyzedAt: Date | null;
    senderIntelEnabled: boolean;
    coldEmailAction: ColdEmailAction;
    autoArchiveNoise: boolean;
    meetingBriefsEnabled: boolean;
    digestFrequency: DigestFrequency;
    digestLastGeneratedAt: Date | null;
    briefingEnabled: boolean;
    briefingHour: number;
    commitmentsEnabled: boolean;
    memoryAutoExtract: boolean;
    overnightReviewEnabled: boolean;
  }>,
): Promise<void> {
  const now = new Date();
  const values: NewAssistantSettings = {
    userId,
    voiceEnabled: patch.voiceEnabled ?? true,
    memoryEnabled: patch.memoryEnabled ?? true,
    knowledgeEnabled: patch.knowledgeEnabled ?? true,
    draftConfidence: patch.draftConfidence ?? "all",
    explicitWritingStyle: patch.explicitWritingStyle ?? null,
    learnedWritingStyle: patch.learnedWritingStyle ?? null,
    senderIntelEnabled: patch.senderIntelEnabled ?? true,
    coldEmailAction: patch.coldEmailAction ?? "label",
    autoArchiveNoise: patch.autoArchiveNoise ?? false,
    meetingBriefsEnabled: patch.meetingBriefsEnabled ?? true,
    digestFrequency: patch.digestFrequency ?? "off",
    briefingEnabled: patch.briefingEnabled ?? true,
    briefingHour: patch.briefingHour ?? 8,
    commitmentsEnabled: patch.commitmentsEnabled ?? true,
    memoryAutoExtract: patch.memoryAutoExtract ?? false,
    overnightReviewEnabled: patch.overnightReviewEnabled ?? true,
    ...(patch.writingStyle !== undefined ? { writingStyle: patch.writingStyle } : {}),
    ...(patch.styleAnalyzedAt !== undefined
      ? { styleAnalyzedAt: patch.styleAnalyzedAt }
      : {}),
    ...(patch.digestLastGeneratedAt !== undefined
      ? { digestLastGeneratedAt: patch.digestLastGeneratedAt }
      : {}),
  };
  await assistantSettingsRepository.upsert({
    values,
    set: {
      ...(patch.voiceEnabled !== undefined ? { voiceEnabled: patch.voiceEnabled } : {}),
      ...(patch.memoryEnabled !== undefined ? { memoryEnabled: patch.memoryEnabled } : {}),
      ...(patch.knowledgeEnabled !== undefined
        ? { knowledgeEnabled: patch.knowledgeEnabled }
        : {}),
      ...(patch.draftConfidence !== undefined
        ? { draftConfidence: patch.draftConfidence }
        : {}),
      ...(patch.explicitWritingStyle !== undefined
        ? { explicitWritingStyle: patch.explicitWritingStyle }
        : {}),
      ...(patch.learnedWritingStyle !== undefined
        ? { learnedWritingStyle: patch.learnedWritingStyle }
        : {}),
      ...(patch.writingStyle !== undefined ? { writingStyle: patch.writingStyle } : {}),
      ...(patch.styleAnalyzedAt !== undefined
        ? { styleAnalyzedAt: patch.styleAnalyzedAt }
        : {}),
      ...(patch.senderIntelEnabled !== undefined
        ? { senderIntelEnabled: patch.senderIntelEnabled }
        : {}),
      ...(patch.coldEmailAction !== undefined
        ? { coldEmailAction: patch.coldEmailAction }
        : {}),
      ...(patch.autoArchiveNoise !== undefined
        ? { autoArchiveNoise: patch.autoArchiveNoise }
        : {}),
      ...(patch.meetingBriefsEnabled !== undefined
        ? { meetingBriefsEnabled: patch.meetingBriefsEnabled }
        : {}),
      ...(patch.digestFrequency !== undefined
        ? { digestFrequency: patch.digestFrequency }
        : {}),
      ...(patch.briefingEnabled !== undefined
        ? { briefingEnabled: patch.briefingEnabled }
        : {}),
      ...(patch.briefingHour !== undefined
        ? { briefingHour: patch.briefingHour }
        : {}),
      ...(patch.commitmentsEnabled !== undefined
        ? { commitmentsEnabled: patch.commitmentsEnabled }
        : {}),
      ...(patch.memoryAutoExtract !== undefined
        ? { memoryAutoExtract: patch.memoryAutoExtract }
        : {}),
      ...(patch.overnightReviewEnabled !== undefined
        ? { overnightReviewEnabled: patch.overnightReviewEnabled }
        : {}),
      ...(patch.digestLastGeneratedAt !== undefined
        ? { digestLastGeneratedAt: patch.digestLastGeneratedAt }
        : {}),
      updatedAt: now,
    },
  });
}

export type DraftContext = {
  version: string;
  /** Voice block: explicit style wins over learned. Null when voice is off. */
  styleBlock: string | null;
  memories: Array<{ kind: string; scopeType: string; scopeValue: string; content: string }>;
  knowledge: Array<{ title: string; content: string }>;
  /** Open promises tied to the thread, either direction. */
  commitments: Array<{
    direction: string;
    description: string;
    dueAt: string | null;
  }>;
};

/**
 * Assemble the personalization context for a reply. Each capability is bounded
 * and skipped when disabled or empty; the result is safe to inject as a
 * labelled prompt block.
 */
export async function buildDraftContext({
  userId,
  senderEmail,
  subject,
  text,
  threadId,
}: {
  userId: string;
  senderEmail: string;
  subject: string | null;
  text: string;
  /** When set, open commitments for the thread are recalled into the prompt. */
  threadId?: string | null;
}): Promise<DraftContext> {
  const config = await getAssistantSettings(userId);

  const [memories, knowledge, commitmentRows] = await Promise.all([
    isAssistantMemoryEnabled() && config.memoryEnabled
      ? selectReplyMemories({ userId, senderEmail, subject, text })
      : Promise.resolve([]),
    isAssistantKnowledgeEnabled() && config.knowledgeEnabled
      ? searchKnowledge({ userId, query: `${subject ?? ""} ${text}`, limit: 5 })
      : Promise.resolve([]),
    threadId && config.commitmentsEnabled
      ? commitmentRepository.listOpenByThread({
          userId,
          threadId,
          limit: 8,
        })
      : Promise.resolve([]),
  ]);

  const styleText =
    isAssistantVoiceEnabled() && config.voiceEnabled
      ? (config.explicitWritingStyle?.trim() ||
          config.learnedWritingStyle?.trim() ||
          null)
      : null;

  return {
    version: DRAFT_PIPELINE_VERSION,
    styleBlock: styleText,
    memories: memories.map((memory) => ({
      kind: memory.kind,
      scopeType: memory.scopeType,
      scopeValue: memory.scopeValue,
      content: memory.content,
    })),
    knowledge: knowledge.map((entry) => ({
      title: entry.title,
      content: entry.content,
    })),
    commitments: commitmentRows.map((row) => ({
      direction: row.direction,
      description: row.description,
      dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    })),
  };
}

/** Render the context as a labelled, injection-safe prompt block. */
export function buildDraftContextPrompt(context: DraftContext): string {
  const sections: string[] = [];

  if (context.styleBlock) {
    sections.push(`<writing_style>\n${context.styleBlock}\n</writing_style>`);
  }

  if (context.memories.length) {
    sections.push(
      [
        "<reply_memories>",
        ...context.memories.map(
          (memory) =>
            `[${memory.kind} | ${memory.scopeType}${
              memory.scopeValue ? `:${memory.scopeValue}` : ""
            }] ${memory.content}`,
        ),
        "</reply_memories>",
      ].join("\n"),
    );
  }

  if (context.knowledge.length) {
    sections.push(
      [
        "<knowledge>",
        ...context.knowledge.map(
          (entry) => `Title: ${entry.title}\nContent: ${entry.content}`,
        ),
        "</knowledge>",
      ].join("\n"),
    );
  }

  if (context.commitments.length) {
    sections.push(
      [
        "<open_commitments>",
        "Promises already made in this thread. Do not contradict them; if a",
        "commitment is now being kept, acknowledge it.",
        ...context.commitments.map(
          (commitment) =>
            `- [${
              commitment.direction === "we_owe" ? "you owe" : "they owe"
            }] ${commitment.description}${
              commitment.dueAt ? ` (due ${commitment.dueAt.slice(0, 10)})` : ""
            }`,
        ),
        "</open_commitments>",
      ].join("\n"),
    );
  }

  return sections.join("\n\n");
}

export type AssistantOverview = {
  config: AssistantConfig;
  counts: { memories: number; knowledge: number; snippets: number };
  /** Whether a model can analyze style right now. */
  aiConfigured: boolean;
};

/** Config + content counts, for the assistant settings screens. */
export async function getAssistantOverview(
  userId: string,
): Promise<AssistantOverview> {
  const [config, memories, knowledge, snippets] = await Promise.all([
    getAssistantSettings(userId),
    replyMemoryRepository.countActive(userId),
    knowledgeRepository.countEntries(userId),
    knowledgeRepository.countSnippets(userId),
  ]);

  const { isAiProviderConfigured } = await import("@/lib/ai/provider");

  return {
    config,
    counts: {
      memories,
      knowledge,
      snippets,
    },
    aiConfigured: isAiProviderConfigured(),
  };
}
