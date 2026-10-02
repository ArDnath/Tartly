/**
 * Search evidence gate (Phase 5).
 *
 * The plan makes ask-inbox semantic search **optional and evidence-gated**:
 * embeddings cost money and add infrastructure, so they are only built if a
 * measurable recall gap proves keyword search is insufficient. This module
 * holds the pure scoring used to decide, and the decision rule. It is
 * deliberately free of any provider/DB import so the eval can run it anywhere.
 *
 * Decision: keyword search is good enough when its recall is at or above
 * `KEYWORD_RECALL_FLOOR`. Below that, a cheap fuzzy (trigram) pass is tried
 * first; if it closes at least `RECALL_IMPROVEMENT_THRESHOLD` of the gap,
 * embeddings are unnecessary. Semantic search is only justified when keyword
 * recall is low *and* fuzzy search cannot fix it.
 */

export const RECALL_IMPROVEMENT_THRESHOLD = 0.2;
export const KEYWORD_RECALL_FLOOR = 0.85;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Fraction of query terms present in the document. */
export function keywordScore(query: string, document: string): number {
  const terms = tokenize(query);
  if (terms.length === 0) return 0;
  const doc = new Set(tokenize(document));
  const hit = terms.filter((term) => doc.has(term)).length;
  return hit / terms.length;
}

function trigrams(text: string): Set<string> {
  const padded = ` ${text.toLowerCase()} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i += 1) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/** Trigram Jaccard-ish overlap, a cheap proxy for fuzzy recall. */
export function trigramScore(query: string, document: string): number {
  const a = trigrams(query);
  const b = trigrams(document);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) {
    if (b.has(gram)) intersection += 1;
  }
  return intersection / Math.min(a.size, b.size);
}

export type SearchFixture = {
  query: string;
  /** Document id → text. */
  documents: Record<string, string>;
  /** Ids the query should recall, by meaning. */
  relevant: string[];
};

export type RecallComparison = {
  keywordRecall: number;
  fuzzyRecall: number;
  improvement: number;
};

function recall(
  fixtures: SearchFixture[],
  score: (query: string, document: string) => number,
  threshold: number,
): number {
  let relevantTotal = 0;
  let relevantFound = 0;
  for (const fixture of fixtures) {
    const ranked = Object.entries(fixture.documents)
      .map(([id, text]) => ({ id, score: score(fixture.query, text) }))
      .filter((entry) => entry.score >= threshold);
    const found = new Set(ranked.map((entry) => entry.id));
    for (const id of fixture.relevant) {
      relevantTotal += 1;
      if (found.has(id)) relevantFound += 1;
    }
  }
  return relevantTotal === 0 ? 1 : relevantFound / relevantTotal;
}

export function compareSearchRecall(fixtures: SearchFixture[]): RecallComparison {
  const keywordRecall = recall(fixtures, keywordScore, 0.5);
  const fuzzyRecall = recall(fixtures, trigramScore, 0.4);
  return {
    keywordRecall,
    fuzzyRecall,
    improvement: Number((fuzzyRecall - keywordRecall).toFixed(3)),
  };
}

export function shouldEnableSemanticSearch(comparison: RecallComparison): boolean {
  // Keyword already good enough → don't build embeddings.
  if (comparison.keywordRecall >= KEYWORD_RECALL_FLOOR) return false;
  // A cheap fuzzy pass closes the gap → don't build embeddings.
  if (comparison.improvement >= RECALL_IMPROVEMENT_THRESHOLD) return false;
  // Keyword is weak and nothing cheap fixes it → semantic search is justified.
  return true;
}
