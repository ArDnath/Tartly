import {
  buildComposeAssistFallback,
  buildComposeAssistPrompt,
} from "../../../lib/ai/features/compose-assist";
import {
  buildFallbackDigestNarrative,
  groupCandidates,
} from "../../../lib/ai/features/digest";
import { buildFallbackFollowupBody } from "../../../lib/ai/features/followup-draft";
import {
  buildFallbackMeetingBrief,
  meetingBriefCacheKey,
} from "../../../lib/ai/features/meeting-brief";
import { heuristicTriage, mergeTriageBatch } from "../../../lib/ai/features/triage";
import {
  deriveReplyStatus,
  replyStatusFromCategory,
} from "../../../lib/ai/features/thread-status";
import { assert, section } from "../harness";

/**
 * Phase 4 — communication superpowers evals.
 *
 * Deterministic: these assert the safety and fallback contracts the plan
 * requires (no-op compose suggestions, digest counts that match the inbox,
 * cached briefs, deterministic follow-up body, reply status) without a model or
 * a mailbox.
 */

export async function run(): Promise<void> {
  section("phase 4 — reply-zero thread status");
  assert(
    deriveReplyStatus({ lastDirection: "outbound" }) === "awaiting_them",
    "an outbound last message is always 'waiting on them'",
  );
  assert(
    deriveReplyStatus({
      lastDirection: "inbound",
      subject: "Question",
      body: "Can you confirm the numbers?",
    }) === "needs_reply",
    "an inbound question needs a reply",
  );
  assert(
    deriveReplyStatus({
      lastDirection: "inbound",
      body: "Thanks, noted.",
    }) === "none",
    "a non-questioning inbound is not forced into needs-you",
  );
  assert(
    replyStatusFromCategory("awaiting_reply") === "awaiting_them" &&
      replyStatusFromCategory("needs_reply") === "needs_reply" &&
      replyStatusFromCategory("fyi") === "none",
    "category fallback maps deterministically",
  );

  section("phase 4 — triage carries reply status");
  const threads = [
    { threadId: "t1", subject: null, body: "Can we meet Tuesday?" },
    { threadId: "t2", subject: null, body: "Thanks for the update." },
  ];
  const merged = mergeTriageBatch(threads, [
    {
      index: 0,
      category: "meeting_request",
      priority: 80,
      action: "draft",
      reason: "asks to meet",
    },
  ]);
  assert(
    merged[0]!.replyStatus === "needs_reply",
    "a model result without replyStatus is backfilled from the category",
  );
  assert(
    merged[1]!.source === "heuristic" &&
      merged[1]!.replyStatus ===
        heuristicTriage(threads[1]!).replyStatus,
    "an omitted thread backfills reply status from the heuristic",
  );
  const explicit = mergeTriageBatch(threads.slice(0, 1), [
    {
      index: 0,
      category: "needs_reply",
      priority: 60,
      action: "draft",
      replyStatus: "awaiting_them",
    },
  ]);
  assert(
    explicit[0]!.replyStatus === "awaiting_them",
    "an explicit model replyStatus is preserved",
  );

  section("phase 4 — compose assist fallback is a safe no-op");
  assert(
    buildComposeAssistFallback({ action: "complete", body: "Hi team," }) === "",
    "complete never invents text without a model",
  );
  assert(
    buildComposeAssistFallback({
      action: "shorten",
      body: "Please review the attached draft when you have a moment.",
    }) === "Please review the attached draft when you have a moment.",
    "a transformation falls back to the input, not a garbled rewrite",
  );
  const prompt = buildComposeAssistPrompt({
    action: "rewrite",
    body: "hey can u send the deck",
    subject: "Deck",
    to: ["a@b.com"],
  });
  assert(
    prompt.includes("<instruction>") && prompt.includes("hey can u send the deck"),
    "the compose prompt labels the instruction and the target text",
  );

  section("phase 4 — follow-up draft has a deterministic body");
  assert(
    buildFallbackFollowupBody("Q3 planning").includes("Re: Q3 planning"),
    "the fallback nudge references the thread subject",
  );
  assert(
    buildFallbackFollowupBody(null).length > 0,
    "a subject-less thread still gets a complete fallback body",
  );

  section("phase 4 — meeting brief cache + fallback");
  const keyA = meetingBriefCacheKey({
    eventId: "e1",
    attendeeEmails: ["b@x.com", "a@x.com"],
    day: "2026-09-30",
  });
  const keyB = meetingBriefCacheKey({
    eventId: "e1",
    attendeeEmails: ["a@x.com", "b@x.com"],
    day: "2026-09-30",
  });
  assert(keyA === keyB, "the brief cache key is attendee-order independent");
  assert(
    meetingBriefCacheKey({
      eventId: "e1",
      attendeeEmails: ["a@x.com"],
      day: "2026-10-01",
    }) !== keyA,
    "the brief cache key changes with the day",
  );
  const brief = buildFallbackMeetingBrief({
    subject: "Intro call",
    attendees: ["a@x.com"],
    priorThreads: [
      { threadId: "t", subject: "Pricing", when: "2026-09-01T00:00:00.000Z", text: "..." },
    ],
  });
  assert(
    brief.source === "heuristic" &&
      brief.talkingPoints.includes("Pricing") &&
      brief.lastTouch?.includes("Pricing") === true,
    "the fallback brief states only what the rows support",
  );

  section("phase 4 — digest grouping matches the inbox");
  const lines = groupCandidates(
    [
      {
        threadId: "n",
        subject: "Big sale",
        category: "newsletter",
        action: "none",
        replyStatus: "none",
        priority: 5,
        reason: null,
        from: "promo@shop.com",
        snippet: "50% off",
      },
      {
        threadId: "r",
        subject: "Question",
        category: "needs_reply",
        action: "draft",
        replyStatus: "needs_reply",
        priority: 60,
        reason: "asks a question",
        from: "jane@acme.com",
        snippet: "Can you...",
      },
      {
        threadId: "w",
        subject: "Sent it",
        category: "awaiting_reply",
        action: "none",
        replyStatus: "awaiting_them",
        priority: 30,
        reason: null,
        from: "sam@acme.com",
        snippet: "Thanks",
      },
      {
        threadId: "h",
        subject: "Receipt",
        category: "invoice",
        action: "none",
        replyStatus: "none",
        priority: 40,
        reason: null,
        from: "billing@vendor.com",
        snippet: "Paid",
      },
    ],
    new Set(["promo@shop.com"]),
  );
  assert(
    lines.find((line) => line.threadId === "n")?.group === "noise",
    "newsletters are grouped as noise",
  );
  assert(
    lines.find((line) => line.threadId === "r")?.group === "needs_you",
    "needs_reply threads are grouped as needs-you",
  );
  assert(
    lines.find((line) => line.threadId === "w")?.group === "waiting",
    "awaiting threads are grouped as waiting",
  );
  assert(
    lines.find((line) => line.threadId === "h")?.group === "handled",
    "invoices are grouped as handled",
  );
  const narrative = buildFallbackDigestNarrative(lines);
  assert(
    narrative.summary.includes("1 need you") && narrative.headline.includes("1"),
    "the offline digest narrative is derived from the counts",
  );
}
