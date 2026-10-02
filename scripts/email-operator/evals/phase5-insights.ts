import {
  buildFallbackReport,
  isoWeekKey,
  reportCacheKey,
} from "../../../lib/ai/features/report";
import {
  normalizeLanguage,
  translateText,
} from "../../../lib/ai/features/translate";
import {
  compareSearchRecall,
  shouldEnableSemanticSearch,
  type SearchFixture,
} from "../../../lib/mail/search-gate";
import { assert, section } from "../harness";

/**
 * Phase 5 — insights, translation, and the semantic-search evidence gate.
 *
 * Deterministic: the weekly report's fallback and cache key, translation input
 * guarding, and the decision rule that gates embeddings are all pure functions.
 * The live model narrative is exercised by the agent evals when a provider is
 * configured.
 */

function metrics(overrides: Record<string, unknown> = {}) {
  return {
    windowDays: 7,
    threadsProcessed: 40,
    needsReply: 3,
    waitingOnThem: 5,
    handled: 32,
    noise: 20,
    noiseRatio: 0.5,
    draftsCreated: 8,
    repliesSent: 6,
    meetingsBooked: 1,
    followupsActive: 2,
    rulesApplied: 0,
    avgResponseHours: 3.2,
    topSenders: [{ email: "news@shop.com", messages: 12 }],
    ...overrides,
  } as Parameters<typeof buildFallbackReport>[0];
}

export async function run(): Promise<void> {
  section("phase 5 — weekly report fallback + cache");
  const week = isoWeekKey(new Date("2026-09-30T12:00:00Z"));
  assert(
    week === isoWeekKey(new Date("2026-10-01T12:00:00Z")),
    "the week key is stable within the same ISO week",
  );
  assert(
    reportCacheKey(week) === reportCacheKey(week) &&
      reportCacheKey(week) !== reportCacheKey("2026-W41"),
    "the report cache key is per week",
  );
  const fallback = buildFallbackReport(metrics());
  assert(
    fallback.headline.includes("3") && fallback.summary.includes("40 threads"),
    "the offline report narrative is derived from the metrics",
  );
  assert(
    fallback.suggestions.some((s) => s.title === "Quiet the noise"),
    "a high noise ratio produces a concrete suggestion",
  );
  assert(
    buildFallbackReport(metrics({ rulesApplied: 4 })).suggestions.every(
      (s) => s.title !== "Automate the repetitive",
    ),
    "suggestions are suppressed once rules are running",
  );

  section("phase 5 — translation guards");
  assert(
    normalizeLanguage("  French  ") === "French" &&
      normalizeLanguage("Chinese (Simplified)") === "Chinese (Simplified)",
    "language names are trimmed and validated",
  );
  assert(
    normalizeLanguage("French<script>") === null &&
      normalizeLanguage("") === null &&
      normalizeLanguage(42) === null,
    "invalid language input is rejected",
  );
  const empty = await translateText({
    userId: "phase5-user",
    text: "   ",
    targetLanguage: "French",
  });
  assert(
    empty.source === "fallback" && empty.text === "   ",
    "empty text falls back unchanged instead of calling a model",
  );

  section("phase 5 — semantic search evidence gate");
  const keywordGood: SearchFixture[] = [
    {
      query: "invoice receipt",
      documents: {
        a: "Your invoice receipt is attached",
        b: "Lunch on Friday?",
      },
      relevant: ["a"],
    },
  ];
  const typoFixed: SearchFixture[] = [
    {
      query: "invoic",
      documents: { a: "Invoice #42 from the vendor", b: "Lunch on Friday?" },
      relevant: ["a"],
    },
  ];
  const semanticGap: SearchFixture[] = [
    {
      query: "refund",
      documents: {
        a: "We will reimburse you within five days",
        b: "Lunch on Friday?",
      },
      relevant: ["a"],
    },
  ];

  const good = compareSearchRecall(keywordGood);
  const typo = compareSearchRecall(typoFixed);
  const gap = compareSearchRecall(semanticGap);

  assert(
    good.keywordRecall >= 0.85 && !shouldEnableSemanticSearch(good),
    "strong keyword recall never justifies embeddings",
  );
  assert(
    typo.keywordRecall < 0.85 &&
      typo.improvement >= 0.2 &&
      !shouldEnableSemanticSearch(typo),
    "when a cheap fuzzy pass fixes recall, embeddings are unnecessary",
  );
  assert(
    shouldEnableSemanticSearch(gap),
    "a genuine synonym gap that fuzzy search cannot close justifies semantic search",
  );
  assert(
    Number.isFinite(good.keywordRecall) &&
      Number.isFinite(typo.fuzzyRecall) &&
      Number.isFinite(gap.improvement),
    "the recall comparison is well-formed",
  );
}
