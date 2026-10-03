import "server-only";

import { nanoid } from "nanoid";
import { z } from "zod";

import { generateObject } from "@/lib/ai/generate";
import { replyMemoryRepository, type ReplyMemory } from "@/lib/repositories/reply-memory";
import {
  REPLY_MEMORY_KINDS,
  REPLY_MEMORY_SCOPES,
  type ReplyMemoryKind,
  type ReplyMemoryScope,
} from "@/lib/db/schema";
import { isAssistantMemoryEnabled } from "@/lib/env";

/**
 * Reply memory (C2).
 *
 * When the user edits an AI draft before sending, the *delta* is a teaching
 * signal: it reveals durable preferences, facts and procedures. We extract at
 * most three, scoped to the sender / domain / topic / global, store them with
 * provenance, and inject the relevant ones into future drafts.
 *
 * Discipline (the reason users can trust this):
 *   - One-off logistics are never stored (durability test in the prompt).
 *   - Nothing is stored when the model is unavailable; extraction is additive.
 *   - Every memory is user-visible and deletable.
 */

export const MAX_MEMORIES_PER_EDIT = 3;
export const MAX_SELECTED_REPLY_MEMORIES = 6;
export const MAX_EXISTING_MEMORIES_IN_PROMPT = 16;
export const MAX_MEMORY_CONTENT_CHARS = 400;

export type { ReplyMemory };

export type ReplyMemoryCandidate = Pick<
  ReplyMemory,
  "id" | "content" | "kind" | "scopeType" | "scopeValue" | "updatedAt"
>;

const newMemorySchema = z.object({
  content: z.string().trim().min(1).max(MAX_MEMORY_CONTENT_CHARS),
  kind: z.enum(REPLY_MEMORY_KINDS),
  scopeType: z.enum(REPLY_MEMORY_SCOPES),
  scopeValue: z.string().trim().max(200),
});

const extractionSchema = z.object({
  memories: z.array(newMemorySchema).max(MAX_MEMORIES_PER_EDIT),
});

const selectionSchema = z.object({
  selectedMemoryIds: z.array(z.string().trim().min(1)).max(MAX_SELECTED_REPLY_MEMORIES),
});

const MEMORY_KIND_LABELS: Record<ReplyMemoryKind, string> = {
  FACT: "reusable factual corrections, business rules, or durable knowledge",
  PREFERENCE: "tone, length, formatting, and phrasing habits",
  PROCEDURE: "repeatable ways to handle a recurring class of replies",
};

export const EXTRACT_SYSTEM_PROMPT = `You analyze how a user edits an AI-generated email reply draft and turn durable patterns into reusable drafting memories.

Return only memories that are likely to help with future drafts.

Memory kinds:
- FACT: ${MEMORY_KIND_LABELS.FACT}
- PREFERENCE: ${MEMORY_KIND_LABELS.PREFERENCE}
- PROCEDURE: ${MEMORY_KIND_LABELS.PROCEDURE}

Scopes:
- GLOBAL: applies broadly to the user's replies (leave scopeValue empty)
- SENDER: applies to one sender email address (use the exact address)
- DOMAIN: applies to one sender domain (use the exact domain; unavailable for public providers)
- TOPIC: applies to a reusable short topic label (e.g. "pricing", "refunds")

Rules:
- Return at most ${MAX_MEMORIES_PER_EDIT} memories.
- Learn only from the user's substantive edit, never from content already in the AI draft.
- Durability test: would following it in a future unrelated thread be correct without the original context? If not, do not store it.
- Skip one-off logistics, temporary states, completed actions, current documents/attachments, and one-time exceptions.
- Prefer concise, direct drafting instructions. Do not copy example sentences; describe the reusable rule.
- PREFERENCE memories are always GLOBAL.
- If nothing durable was learned, return an empty array.`;

/* -------------------------------------------------------------------------- */
/*  Pure helpers                                                               */
/* -------------------------------------------------------------------------- */

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Whether the sent body differs from the AI draft beyond whitespace/case. */
export function hasMeaningfulEdit(draft: string, sent: string): boolean {
  const a = normalizeText(draft);
  const b = normalizeText(sent);
  if (!a || !b) return false;
  return a !== b;
}

export function extractDomainFromEmail(email: string): string {
  const at = email.indexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
}

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
]);

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.toLowerCase());
}

/** Most specific scope first, so the fallback selector prefers precise rules. */
export const SCOPE_PRIORITY: Record<ReplyMemoryScope, number> = {
  SENDER: 0,
  DOMAIN: 1,
  TOPIC: 2,
  GLOBAL: 3,
};

export function rankMemoryCandidates<T extends ReplyMemoryCandidate>(
  candidates: T[],
): T[] {
  return [...candidates].sort((a, b) => {
    const scope = SCOPE_PRIORITY[a.scopeType] - SCOPE_PRIORITY[b.scopeType];
    if (scope !== 0) return scope;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}

export function isValidTopicScopeValue(value: string): boolean {
  const topic = value.trim();
  if (!topic || topic.length > 80) return false;
  if (topic.split(/\s+/).length > 10) return false;
  return /^[\p{L}\p{N}][\p{L}\p{N} /&+-]*$/u.test(topic);
}

/** Keep only well-formed, in-domain memories from a model response. */
export function sanitizeExtractedMemories(
  memories: z.infer<typeof newMemorySchema>[],
  { allowDomainScope }: { allowDomainScope: boolean },
): z.infer<typeof newMemorySchema>[] {
  return memories
    .map((memory) => {
      const kind = memory.kind;
      const scopeType: ReplyMemoryScope =
        kind === "PREFERENCE" ? "GLOBAL" : memory.scopeType;
      return {
        content: memory.content.trim(),
        kind,
        scopeType,
        scopeValue:
          kind === "PREFERENCE" || scopeType === "GLOBAL"
            ? ""
            : memory.scopeValue.trim(),
      };
    })
    .filter((memory) => {
      if (memory.scopeType === "DOMAIN" && !allowDomainScope) return false;
      if (memory.scopeType === "TOPIC" && !isValidTopicScopeValue(memory.scopeValue)) {
        return false;
      }
      return memory.content.length > 0;
    })
    .slice(0, MAX_MEMORIES_PER_EDIT);
}

/* -------------------------------------------------------------------------- */
/*  Extraction (on draft send)                                                 */
/* -------------------------------------------------------------------------- */

export async function extractReplyMemories({
  userId,
  incoming,
  draft,
  sent,
  senderEmail,
  existingMemories,
}: {
  userId: string;
  incoming: string;
  draft: string;
  sent: string;
  senderEmail: string;
  existingMemories: ReplyMemoryCandidate[];
}): Promise<Array<z.infer<typeof newMemorySchema>>> {
  const sender = senderEmail.trim().toLowerCase();
  if (!sender || !hasMeaningfulEdit(draft, sent)) return [];

  const domain = extractDomainFromEmail(sender);
  const allowDomainScope = domain !== "" && !isPublicEmailDomain(domain);

  const result = await generateObject({
    schema: extractionSchema,
    role: "fast",
    feature: "reply-memory-extraction",
    userId,
    system: EXTRACT_SYSTEM_PROMPT,
    prompt: buildExtractionPrompt({
      sender,
      domain,
      incoming,
      draft,
      sent,
      existingMemories,
      allowDomainScope,
    }),
    hardening: { trust: "untrusted", level: "full" },
    maxOutputTokens: 500,
  });

  // No model → no extraction. Never guess a durable preference.
  if (!result) return [];
  return sanitizeExtractedMemories(result.memories, { allowDomainScope });
}

function buildExtractionPrompt({
  sender,
  domain,
  incoming,
  draft,
  sent,
  existingMemories,
  allowDomainScope,
}: {
  sender: string;
  domain: string;
  incoming: string;
  draft: string;
  sent: string;
  existingMemories: ReplyMemoryCandidate[];
  allowDomainScope: boolean;
}): string {
  const existing = existingMemories
    .slice(0, MAX_EXISTING_MEMORIES_IN_PROMPT)
    .map(
      (memory, index) =>
        `${index + 1}. [${memory.kind} | ${memory.scopeType}${
          memory.scopeValue ? `:${memory.scopeValue}` : ""
        }] ${memory.content}`,
    )
    .join("\n");

  return `<source_email_sender>${sender}</source_email_sender>
<source_email_domain>${domain || "unknown"}</source_email_domain>
<domain_scope_available>${allowDomainScope ? "yes" : "no (public email provider)"}</domain_scope_available>

<incoming_email>
${incoming.slice(0, 4_000)}
</incoming_email>

<ai_draft>
${draft.slice(0, 4_000)}
</ai_draft>

<user_sent>
${sent.slice(0, 4_000)}
</user_sent>

<existing_memories>
${existing || "None"}
</existing_memories>

Extract reusable reply memories from this draft edit.`;
}

/* -------------------------------------------------------------------------- */
/*  Persistence                                                                */
/* -------------------------------------------------------------------------- */

export async function storeReplyMemories({
  userId,
  memories,
  sourceDraftId,
  sourceThreadId,
}: {
  userId: string;
  memories: Array<z.infer<typeof newMemorySchema>>;
  sourceDraftId?: string;
  sourceThreadId?: string;
}): Promise<number> {
  if (memories.length === 0) return 0;

  // Dedupe against the user's existing active memories (exact content+scope).
  const existing = await listReplyMemories({ userId, limit: 500 });
  const seen = new Set(
    existing.map(
      (memory) => `${memory.scopeType}:${memory.scopeValue}:${normalizeText(memory.content)}`,
    ),
  );

  let stored = 0;
  for (const memory of memories) {
    const key = `${memory.scopeType}:${memory.scopeValue}:${normalizeText(memory.content)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await replyMemoryRepository.insert({
      id: nanoid(),
      userId,
      kind: memory.kind,
      scopeType: memory.scopeType,
      scopeValue: memory.scopeValue,
      content: memory.content,
      sourceDraftId: sourceDraftId ?? null,
      sourceThreadId: sourceThreadId ?? null,
    });
    stored += 1;
  }
  return stored;
}

/**
 * Learn from a draft edit and persist the durable memories. Best-effort: never
 * throws, never blocks a send.
 */
export async function learnFromDraftEdit({
  userId,
  senderEmail,
  incoming,
  draft,
  sent,
  sourceDraftId,
  sourceThreadId,
}: {
  userId: string;
  senderEmail: string;
  incoming: string;
  draft: string;
  sent: string;
  sourceDraftId?: string;
  sourceThreadId?: string;
}): Promise<{ stored: number }> {
  try {
    if (!isAssistantMemoryEnabled()) return { stored: 0 };
    if (!hasMeaningfulEdit(draft, sent)) return { stored: 0 };

    const existing = await listReplyMemories({ userId, limit: MAX_EXISTING_MEMORIES_IN_PROMPT });
    const memories = await extractReplyMemories({
      userId,
      incoming,
      draft,
      sent,
      senderEmail,
      existingMemories: existing,
    });
    const stored = await storeReplyMemories({
      userId,
      memories,
      ...(sourceDraftId ? { sourceDraftId } : {}),
      ...(sourceThreadId ? { sourceThreadId } : {}),
    });
    return { stored };
  } catch (error) {
    console.warn("[ai/reply-memory] learning failed", error);
    return { stored: 0 };
  }
}

export async function listReplyMemories({
  userId,
  limit = 200,
}: {
  userId: string;
  limit?: number;
}): Promise<ReplyMemory[]> {
  return replyMemoryRepository.listActive(userId, Math.min(Math.max(limit, 1), 500));
}

export async function archiveReplyMemory({
  userId,
  memoryId,
}: {
  userId: string;
  memoryId: string;
}): Promise<boolean> {
  return replyMemoryRepository.archive({ userId, memoryId, now: new Date() });
}

/* -------------------------------------------------------------------------- */
/*  Auto-memory (opt-in exchange learning)                                     */
/* -------------------------------------------------------------------------- */

const EXCHANGE_SYSTEM_PROMPT = `You analyze an email exchange (an inbound message and the reply that handled it) and turn durable patterns into reusable drafting memories.

Return only memories that are likely to help with future drafts.

Memory kinds:
- FACT: ${MEMORY_KIND_LABELS.FACT}
- PREFERENCE: ${MEMORY_KIND_LABELS.PREFERENCE}
- PROCEDURE: ${MEMORY_KIND_LABELS.PROCEDURE}

Scopes:
- GLOBAL: applies broadly to the user's replies (leave scopeValue empty)
- SENDER: applies to one sender email address (use the exact address)
- DOMAIN: applies to one sender domain (use the exact domain; unavailable for public providers)
- TOPIC: applies to a reusable short topic label (e.g. "pricing", "refunds")

Rules:
- Return at most ${MAX_MEMORIES_PER_EDIT} memories.
- Learn only durable facts, preferences or procedures *evidenced by the reply* — not one-off logistics, temporary states, or the mere content of the inbound message.
- Durability test: would following it in a future unrelated thread be correct without the original context? If not, do not store it.
- Prefer concise, direct drafting instructions. Do not copy example sentences; describe the reusable rule.
- PREFERENCE memories are always GLOBAL.
- If nothing durable was learned, return an empty array.`;

/**
 * Extract durable memories from a full exchange (inbound + the reply that
 * handled it). Mirrors `extractReplyMemories`, but reads an exchange rather
 * than a draft edit; the durability rules and scopes are identical.
 */
export async function extractMemoriesFromExchange({
  userId,
  incoming,
  reply,
  senderEmail,
  existingMemories,
}: {
  userId: string;
  incoming: string;
  reply: string;
  senderEmail: string;
  existingMemories: ReplyMemoryCandidate[];
}): Promise<Array<z.infer<typeof newMemorySchema>>> {
  const sender = senderEmail.trim().toLowerCase();
  if (!sender || !incoming.trim() || !reply.trim()) return [];

  const domain = extractDomainFromEmail(sender);
  const allowDomainScope = domain !== "" && !isPublicEmailDomain(domain);

  const existing = existingMemories
    .slice(0, MAX_EXISTING_MEMORIES_IN_PROMPT)
    .map(
      (memory, index) =>
        `${index + 1}. [${memory.kind} | ${memory.scopeType}${
          memory.scopeValue ? `:${memory.scopeValue}` : ""
        }] ${memory.content}`,
    )
    .join("\n");

  const result = await generateObject({
    schema: extractionSchema,
    role: "fast",
    feature: "reply-memory-exchange",
    userId,
    system: EXCHANGE_SYSTEM_PROMPT,
    prompt: `<source_email_sender>${sender}</source_email_sender>
<source_email_domain>${domain || "unknown"}</source_email_domain>
<domain_scope_available>${allowDomainScope ? "yes" : "no (public email provider)"}</domain_scope_available>

<incoming_email>
${incoming.slice(0, 4_000)}
</incoming_email>

<reply_sent>
${reply.slice(0, 4_000)}
</reply_sent>

<existing_memories>
${existing || "None"}
</existing_memories>

Extract reusable reply memories from this exchange.`,
    hardening: { trust: "untrusted", level: "full" },
    maxOutputTokens: 500,
  });

  if (!result) return [];
  return sanitizeExtractedMemories(result.memories, { allowDomainScope });
}

/**
 * Learn from a handled exchange and persist the durable memories. Best-effort:
 * never throws, never blocks the flow.
 */
export async function learnFromExchange({
  userId,
  senderEmail,
  incoming,
  reply,
  sourceThreadId,
}: {
  userId: string;
  senderEmail: string;
  incoming: string;
  reply: string;
  sourceThreadId?: string;
}): Promise<{ stored: number }> {
  try {
    if (!isAssistantMemoryEnabled()) return { stored: 0 };

    const existing = await listReplyMemories({
      userId,
      limit: MAX_EXISTING_MEMORIES_IN_PROMPT,
    });
    const memories = await extractMemoriesFromExchange({
      userId,
      incoming,
      reply,
      senderEmail,
      existingMemories: existing,
    });
    const stored = await storeReplyMemories({
      userId,
      memories,
      ...(sourceThreadId ? { sourceThreadId } : {}),
    });
    return { stored };
  } catch (error) {
    console.warn("[ai/reply-memory] exchange learning failed", error);
    return { stored: 0 };
  }
}

/* -------------------------------------------------------------------------- */
/*  Selection (at draft time)                                                  */
/* -------------------------------------------------------------------------- */

/** Deterministic relevance filter + ranking — the fallback selector. */
export function rankRelevantMemories({
  memories,
  senderEmail,
  subject,
  text,
}: {
  memories: ReplyMemoryCandidate[];
  senderEmail: string;
  subject: string | null;
  text: string;
}): ReplyMemoryCandidate[] {
  const sender = senderEmail.trim().toLowerCase();
  const domain = extractDomainFromEmail(sender);
  const haystack = `${subject ?? ""}\n${text}`.toLowerCase();

  const relevant = memories.filter((memory) => {
    switch (memory.scopeType) {
      case "GLOBAL":
        return true;
      case "SENDER":
        return memory.scopeValue.toLowerCase() === sender;
      case "DOMAIN":
        return domain !== "" && memory.scopeValue.toLowerCase() === domain;
      case "TOPIC":
        return (
          memory.scopeValue.length > 0 &&
          haystack.includes(memory.scopeValue.toLowerCase())
        );
    }
  });

  return rankMemoryCandidates(relevant);
}

export async function selectReplyMemories({
  userId,
  senderEmail,
  subject,
  text,
}: {
  userId: string;
  senderEmail: string;
  subject: string | null;
  text: string;
}): Promise<ReplyMemoryCandidate[]> {
  const all = await listReplyMemories({ userId, limit: 300 });
  const ranked = rankRelevantMemories({
    memories: all,
    senderEmail,
    subject,
    text,
  });
  if (ranked.length <= MAX_SELECTED_REPLY_MEMORIES) return ranked;

  const selectedIds = await aiSelectRelevantReplyMemories({
    userId,
    candidates: ranked.slice(0, 40),
    emailContent: `${subject ?? ""}\n${text}`.slice(0, 4_000),
  });

  if (!selectedIds) return ranked.slice(0, MAX_SELECTED_REPLY_MEMORIES);

  const byId = new Map(ranked.map((memory) => [memory.id, memory]));
  const selected = selectedIds
    .map((id) => byId.get(id))
    .filter((memory): memory is ReplyMemoryCandidate => Boolean(memory));
  return selected.length ? selected : ranked.slice(0, MAX_SELECTED_REPLY_MEMORIES);
}

async function aiSelectRelevantReplyMemories({
  userId,
  candidates,
  emailContent,
}: {
  userId: string;
  candidates: ReplyMemoryCandidate[];
  emailContent: string;
}): Promise<string[] | null> {
  const result = await generateObject({
    schema: selectionSchema,
    role: "fast",
    feature: "reply-memory-selection",
    userId,
    system: `Select which stored reply memories are relevant to drafting a reply to a specific email. Injecting irrelevant memories degrades drafts, so be selective. Prefer concrete facts over generic advice; if none clearly apply, return an empty list. Return at most ${MAX_SELECTED_REPLY_MEMORIES} ids, most relevant first.`,
    prompt: [
      "<incoming_email>",
      emailContent,
      "</incoming_email>",
      "",
      "<candidate_memories>",
      ...candidates.map(
        (memory, index) =>
          `${index + 1}. id=${memory.id} [${memory.kind} | ${memory.scopeType}${memory.scopeValue ? `:${memory.scopeValue}` : ""}] ${memory.content}`,
      ),
      "</candidate_memories>",
      "",
      "Return the ids of the relevant memories.",
    ].join("\n"),
    hardening: { trust: "untrusted", level: "compact" },
    maxOutputTokens: 200,
  });

  if (!result) return null;
  const candidateIds = new Set(candidates.map((memory) => memory.id));
  return result.selectedMemoryIds
    .filter((id) => candidateIds.has(id))
    .slice(0, MAX_SELECTED_REPLY_MEMORIES);
}
