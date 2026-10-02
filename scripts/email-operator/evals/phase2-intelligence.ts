import {
  COLD_EMAIL_THRESHOLD,
  deterministicColdEmailVerdict,
  heuristicColdEmailScore,
  isAutomatedSender,
  type ColdEmailSignals,
} from "../../../lib/ai/features/cold-email";
import {
  heuristicCategorizeSender,
  sanitizeSenderCategories,
} from "../../../lib/ai/features/categorize-sender";
import { marketingScoreFromHeaders } from "../../../lib/ai/features/sender-profiles";
import {
  mergeTriageBatch,
  heuristicTriage,
  TRIAGE_BATCH_MAX,
} from "../../../lib/ai/features/triage";
import {
  selectUnsubscribeMechanism,
  type UnsubscribeMechanism,
} from "../../../lib/ai/features/unsubscribe";
import {
  buildFallbackThreadSummary,
  shouldSummarize,
  summaryCacheKey,
} from "../../../lib/ai/features/summarize-thread";
import { assert, section } from "../harness";

/**
 * Phase 2 — inbox intelligence evals.
 *
 * Pure and deterministic: these assert the *guards* the plan requires (a known
 * sender never reaches the model, a category is never invented, a summary cache
 * key is stable) without spending a token or touching Gmail. The model path is
 * exercised separately by the live agent evals when a provider is configured.
 */

function signals(overrides: Partial<ColdEmailSignals> = {}): ColdEmailSignals {
  return {
    email: "lead@unknown-agency.com",
    domain: "unknown-agency.com",
    fromName: "Sales Rep",
    subject: "Quick call?",
    body: "I came across your company and would love a quick call.",
    isKnownContact: false,
    hasPriorOutbound: false,
    isSameOrg: false,
    unsubscribe: null,
    status: null,
    ...overrides,
  };
}

export async function run(): Promise<void> {
  section("phase 2 — cold email guards");
  assert(
    deterministicColdEmailVerdict(signals({ isKnownContact: true }))?.score === 0,
    "a known contact is never cold (no model call)",
  );
  assert(
    deterministicColdEmailVerdict(signals({ hasPriorOutbound: true }))?.score === 0,
    "a sender the user has emailed is never cold",
  );
  assert(
    deterministicColdEmailVerdict(signals({ isSameOrg: true }))?.score === 0,
    "a same-domain colleague is never cold",
  );
  assert(
    deterministicColdEmailVerdict(signals({ status: "allowed" }))?.score === 0,
    "a user-allowed sender is never cold",
  );
  const bulk = deterministicColdEmailVerdict(
    signals({ unsubscribe: { oneClick: true, url: "https://x.test/u" } }),
  );
  assert(
    bulk !== null && !bulk.isCold && bulk.score < COLD_EMAIL_THRESHOLD,
    "a bulk sender with an unsubscribe header is not cold",
  );
  assert(
    deterministicColdEmailVerdict(signals()) === null,
    "a genuinely unknown sender is deferred to the model",
  );
  assert(
    heuristicColdEmailScore(signals()) < COLD_EMAIL_THRESHOLD,
    "the offline heuristic never asserts cold on its own",
  );
  assert(
    isAutomatedSender("no-reply@acme.com") && !isAutomatedSender("jane@acme.com"),
    "automated addresses are recognised deterministically",
  );

  section("phase 2 — unsubscribe mechanism selection");
  const chosen: UnsubscribeMechanism[] = [
    selectUnsubscribeMechanism({
      oneClick: true,
      url: "https://x.test/one",
      mailto: "mailto:u@x.test",
    }),
    selectUnsubscribeMechanism({ oneClick: false, mailto: "mailto:u@x.test" }),
    selectUnsubscribeMechanism({ oneClick: false, url: "https://x.test/link" }),
    selectUnsubscribeMechanism(null),
  ];
  assert(chosen[0]!.method === "one-click", "one-click wins when advertised");
  assert(chosen[1]!.method === "mailto", "mailto is the second choice");
  assert(chosen[2]!.method === "link", "a bare URL falls back to a link");
  assert(chosen[3]!.method === "none", "no headers means no mechanism");

  section("phase 2 — sender categorization guards");
  assert(
    heuristicCategorizeSender({
      email: "promo@shop.com",
      domain: "shop.com",
      fromName: "Shop",
      marketingScore: 80,
      isCold: false,
    }).category === "Newsletters" ||
      heuristicCategorizeSender({
        email: "promo@shop.com",
        domain: "shop.com",
        fromName: "Shop",
        marketingScore: 80,
        isCold: false,
      }).category === "Notifications",
    "high bulk signal routes to a noise category",
  );
  assert(
    heuristicCategorizeSender({
      email: "lead@agency.com",
      domain: "agency.com",
      fromName: null,
      marketingScore: 0,
      isCold: true,
    }).category === "Cold Outreach",
    "a cold sender is categorised as Cold Outreach",
  );
  const invented = sanitizeSenderCategories(
    [
      { email: "real@x.com", category: "Work", confidence: 80, source: "model" },
      { email: "ghost@y.com", category: "Personal", confidence: 80, source: "model" },
    ],
    ["real@x.com"],
  );
  assert(
    invented.length === 1 && invented[0]!.email === "real@x.com",
    "the model cannot introduce a sender that was not in the input",
  );
  assert(
    marketingScoreFromHeaders({ oneClick: true, url: "https://x", listId: "l" }) ===
      100,
    "bulk header signals accumulate deterministically",
  );

  section("phase 2 — batched triage parity");
  const threads = [
    { threadId: "t1", subject: null, body: "Can we meet Tuesday?" },
    { threadId: "t2", subject: null, body: "Invoice #42 attached" },
    { threadId: "t3", subject: null, body: "Click to unsubscribe from our newsletter" },
  ];
  assert(TRIAGE_BATCH_MAX >= 3, "the batch cap covers the inbound job size");
  // Model returns results for t1/t3 only; t2 must be backfilled deterministically.
  const merged = mergeTriageBatch(threads, [
    { index: 0, category: "meeting_request", priority: 80, action: "draft", reason: "asks to meet" },
    { index: 2, category: "newsletter", priority: 5, action: "none", reason: "unsubscribe link" },
  ]);
  assert(
    merged.length === threads.length &&
      merged.every((entry, index) => entry.threadId === threads[index]!.threadId),
    "batch results stay aligned to the input threads",
  );
  assert(
    merged[2]!.category === "newsletter" && merged[2]!.source === "model",
    "model results are used when present",
  );
  assert(
    merged[1]!.category === heuristicTriage(threads[1]!).category &&
      merged[1]!.source === "heuristic",
    "an omitted thread is backfilled from the heuristic (parity)",
  );

  section("phase 2 — summary cache + fallback");
  const key = summaryCacheKey({ threadId: "t1", lastMessageAt: "2026-01-01T00:00:00.000Z" });
  assert(
    key === summaryCacheKey({ threadId: "t1", lastMessageAt: "2026-01-01T00:00:00.000Z" }) &&
      key !== summaryCacheKey({ threadId: "t1", lastMessageAt: "2026-01-02T00:00:00.000Z" }),
    "the summary cache key is stable per (thread, lastMessageAt)",
  );
  assert(
    shouldSummarize(5) && !shouldSummarize(2),
    "short threads do not offer a summary",
  );
  const fallback = buildFallbackThreadSummary([
    { direction: "inbound", from: "a@x.com", sentAt: null, text: "First message about pricing" },
    { direction: "outbound", from: "me@x.com", sentAt: null, text: "Latest note" },
  ]);
  assert(
    fallback.source === "heuristic" && fallback.summary.includes("Latest"),
    "the offline summary falls back to a bounded excerpt, not a fabrication",
  );
}
