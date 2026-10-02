import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { knowledgeEntries, snippets } from "@/lib/db/schema";

/**
 * Knowledge base + snippets (C3).
 *
 * The user's own facts and reusable fragments. Retrieval is deterministic
 * (BM25-ish keyword scoring over a bounded set) — no embeddings, no model call —
 * so it is free and always available. `{{snippet:shortcut}}` expands in compose
 * and in drafts.
 */

export const MAX_KNOWLEDGE_ENTRIES = 500;
export const MAX_SNIPPET_CONTENT_CHARS = 4_000;
export const MAX_ENTRY_CONTENT_CHARS = 8_000;
export const DEFAULT_KNOWLEDGE_RESULTS = 5;

export type KnowledgeEntry = typeof knowledgeEntries.$inferSelect;
export type Snippet = typeof snippets.$inferSelect;

const STOP_WORDS = new Set([
  "the", "and", "for", "you", "your", "with", "that", "this", "are", "was",
  "have", "has", "not", "but", "can", "will", "our", "from", "about", "into",
  "they", "their", "them", "what", "when", "where", "which", "who", "how",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

/**
 * BM25 score for one document. Pure and testable; `avgLength`/`docCount` come
 * from the corpus so rare terms weigh more.
 */
export function bm25Score({
  queryTokens,
  docTokens,
  avgLength,
  docCount,
  docFrequency,
  k1 = 1.5,
  b = 0.75,
}: {
  queryTokens: string[];
  docTokens: string[];
  avgLength: number;
  docCount: number;
  docFrequency: Map<string, number>;
  k1?: number;
  b?: number;
}): number {
  if (docTokens.length === 0 || avgLength === 0) return 0;
  const frequencies = new Map<string, number>();
  for (const token of docTokens) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }

  let score = 0;
  for (const token of new Set(queryTokens)) {
    const termFrequency = frequencies.get(token);
    if (!termFrequency) continue;
    const idf = Math.log(
      1 + (docCount - (docFrequency.get(token) ?? 0) + 0.5) /
        ((docFrequency.get(token) ?? 0) + 0.5),
    );
    const denominator =
      termFrequency + k1 * (1 - b + (b * docTokens.length) / avgLength);
    score += idf * ((termFrequency * (k1 + 1)) / denominator);
  }
  return score;
}

export type KnowledgeMatch = KnowledgeEntry & { score: number };

/** Keyword-ranked search over the user's knowledge entries. */
export async function searchKnowledge({
  userId,
  query,
  limit = DEFAULT_KNOWLEDGE_RESULTS,
}: {
  userId: string;
  query: string;
  limit?: number;
}): Promise<KnowledgeMatch[]> {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const entries = await listKnowledgeEntries({ userId, limit: MAX_KNOWLEDGE_ENTRIES });
  if (entries.length === 0) return [];

  const docs = entries.map((entry) => ({
    entry,
    // Title terms are a strong signal: repeat them so they weigh more.
    tokens: [
      ...tokenize(entry.title),
      ...tokenize(entry.title),
      ...tokenize(entry.content),
    ],
  }));

  const docFrequency = new Map<string, number>();
  for (const doc of docs) {
    for (const token of new Set(doc.tokens)) {
      docFrequency.set(token, (docFrequency.get(token) ?? 0) + 1);
    }
  }
  const avgLength =
    docs.reduce((total, doc) => total + doc.tokens.length, 0) / docs.length;

  return docs
    .map((doc) => ({
      ...doc.entry,
      score: bm25Score({
        queryTokens,
        docTokens: doc.tokens,
        avgLength,
        docCount: docs.length,
        docFrequency,
      }),
    }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(Math.max(limit, 1), 20));
}

export async function listKnowledgeEntries({
  userId,
  limit = 200,
}: {
  userId: string;
  limit?: number;
}): Promise<KnowledgeEntry[]> {
  return db
    .select()
    .from(knowledgeEntries)
    .where(eq(knowledgeEntries.userId, userId))
    .orderBy(desc(knowledgeEntries.updatedAt))
    .limit(Math.min(Math.max(limit, 1), MAX_KNOWLEDGE_ENTRIES));
}

export async function createKnowledgeEntry({
  userId,
  title,
  content,
}: {
  userId: string;
  title: string;
  content: string;
}): Promise<KnowledgeEntry> {
  const inserted = await db
    .insert(knowledgeEntries)
    .values({
      id: nanoid(),
      userId,
      title: title.trim().slice(0, 200),
      content: content.trim().slice(0, MAX_ENTRY_CONTENT_CHARS),
    })
    .returning();
  return inserted[0]!;
}

export async function updateKnowledgeEntry({
  userId,
  id,
  title,
  content,
}: {
  userId: string;
  id: string;
  title?: string;
  content?: string;
}): Promise<boolean> {
  const updated = await db
    .update(knowledgeEntries)
    .set({
      ...(title !== undefined ? { title: title.trim().slice(0, 200) } : {}),
      ...(content !== undefined
        ? { content: content.trim().slice(0, MAX_ENTRY_CONTENT_CHARS) }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(eq(knowledgeEntries.id, id), eq(knowledgeEntries.userId, userId)),
    )
    .returning({ id: knowledgeEntries.id });
  return updated.length > 0;
}

export async function deleteKnowledgeEntry({
  userId,
  id,
}: {
  userId: string;
  id: string;
}): Promise<boolean> {
  const deleted = await db
    .delete(knowledgeEntries)
    .where(
      and(eq(knowledgeEntries.id, id), eq(knowledgeEntries.userId, userId)),
    )
    .returning({ id: knowledgeEntries.id });
  return deleted.length > 0;
}

/* -------------------------------------------------------------------------- */
/*  Snippets                                                                   */
/* -------------------------------------------------------------------------- */

export const SNIPPET_PATTERN = /\{\{\s*snippet\s*:\s*([a-z0-9._-]+)\s*\}\}/gi;

export function extractSnippetShortcuts(text: string): string[] {
  const shortcuts: string[] = [];
  for (const match of text.matchAll(SNIPPET_PATTERN)) {
    const shortcut = match[1]?.toLowerCase();
    if (shortcut && !shortcuts.includes(shortcut)) shortcuts.push(shortcut);
  }
  return shortcuts;
}

export async function listSnippets({
  userId,
  limit = 500,
}: {
  userId: string;
  limit?: number;
}): Promise<Snippet[]> {
  return db
    .select()
    .from(snippets)
    .where(eq(snippets.userId, userId))
    .orderBy(desc(snippets.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}

export async function createSnippet({
  userId,
  shortcut,
  content,
}: {
  userId: string;
  shortcut: string;
  content: string;
}): Promise<Snippet> {
  const inserted = await db
    .insert(snippets)
    .values({
      id: nanoid(),
      userId,
      shortcut: normalizeShortcut(shortcut),
      content: content.trim().slice(0, MAX_SNIPPET_CONTENT_CHARS),
    })
    .returning();
  return inserted[0]!;
}

export async function updateSnippet({
  userId,
  id,
  shortcut,
  content,
}: {
  userId: string;
  id: string;
  shortcut?: string;
  content?: string;
}): Promise<boolean> {
  const updated = await db
    .update(snippets)
    .set({
      ...(shortcut !== undefined ? { shortcut: normalizeShortcut(shortcut) } : {}),
      ...(content !== undefined
        ? { content: content.trim().slice(0, MAX_SNIPPET_CONTENT_CHARS) }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(snippets.id, id), eq(snippets.userId, userId)))
    .returning({ id: snippets.id });
  return updated.length > 0;
}

export async function deleteSnippet({
  userId,
  id,
}: {
  userId: string;
  id: string;
}): Promise<boolean> {
  const deleted = await db
    .delete(snippets)
    .where(and(eq(snippets.id, id), eq(snippets.userId, userId)))
    .returning({ id: snippets.id });
  return deleted.length > 0;
}

export function normalizeShortcut(shortcut: string): string {
  return shortcut
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .slice(0, 60);
}

/**
 * Replace every `{{snippet:shortcut}}` with its content. Unknown shortcuts are
 * left untouched so a draft never silently loses text.
 */
export async function expandSnippets({
  userId,
  text,
}: {
  userId: string;
  text: string;
}): Promise<{ text: string; applied: string[] }> {
  const shortcuts = extractSnippetShortcuts(text);
  if (shortcuts.length === 0) return { text, applied: [] };

  const all = await listSnippets({ userId });
  const byShortcut = new Map(all.map((snippet) => [snippet.shortcut, snippet.content]));

  const applied: string[] = [];
  const expanded = text.replace(SNIPPET_PATTERN, (match, rawShortcut: string) => {
    const content = byShortcut.get(rawShortcut.toLowerCase());
    if (content === undefined) return match;
    applied.push(rawShortcut.toLowerCase());
    return content;
  });

  return { text: expanded, applied };
}
