import {
  buildManualRule,
  sanitizeCompiledRule,
} from "../../../lib/ai/features/compile-rule";
import {
  collectDraftInstruction,
  evaluateConditionDeterministically,
  type RuleEvalContext,
} from "../../../lib/ai/features/rules";
import type { RuleCondition } from "../../../lib/db/schema";
import { assert, section } from "../harness";

/**
 * Phase 3 — plain-English rule evals.
 *
 * Deterministic: the compiler's sanitizer and the evaluation semantics are pure
 * functions, so these assert the safety contract (only supported actions, no
 * placeholders, static/learned rules never *require* a model, and a SEND action
 * only ever produces a draft instruction) without a provider or a mailbox.
 */

function condition(overrides: Partial<RuleCondition> = {}): RuleCondition {
  return {
    logic: "AND",
    ai: null,
    from: null,
    to: null,
    subject: null,
    categories: [],
    ...overrides,
  };
}

function context(overrides: Partial<RuleEvalContext> = {}): RuleEvalContext {
  return {
    from: "billing@vendor.com",
    to: ["me@example.com"],
    subject: "Invoice #42",
    body: "Your invoice is attached.",
    categories: ["Receipts"],
    hasUnsubscribe: false,
    coldEmail: false,
    ...overrides,
  };
}

export async function run(): Promise<void> {
  section("phase 3 — rule compiler sanitizer");
  const cleaned = sanitizeCompiledRule({
    name: "Invoices",
    condition: condition({ categories: ["Receipts"] }),
    actions: [
      { type: "LABEL", fields: { label: "Receipts" } },
      { type: "ARCHIVE", fields: {} },
      // Incomplete actions are dropped, not stored with a placeholder.
      { type: "LABEL", fields: { label: "TBD" } },
      { type: "MOVE_FOLDER", fields: {} },
    ],
  });
  assert(
    cleaned?.actions.length === 2 &&
      cleaned.actions[0]!.type === "LABEL" &&
      cleaned.actions[1]!.type === "ARCHIVE",
    "the sanitizer keeps complete actions and drops incomplete/placeholder ones",
  );
  assert(
    sanitizeCompiledRule({
      name: "Bad",
      condition: condition(),
      actions: [{ type: "DRAFT_REPLY", fields: {} }],
    }) === null,
    "a rule with no usable actions is rejected",
  );
  assert(
    sanitizeCompiledRule({
      name: "  ",
      condition: condition({ subject: "  " }),
      actions: [{ type: "STAR", fields: {} }],
    })?.condition.subject === null,
    "blank/placeholder condition fields are nulled, not stored",
  );
  const manual = buildManualRule({
    name: "From Alice",
    condition: { from: "alice@acme.com" },
    actions: [{ type: "STAR", fields: {} }],
  });
  assert(
    manual?.condition.from === "alice@acme.com" &&
      manual.actions[0]!.type === "STAR",
    "the manual form builds a valid rule without a model",
  );

  section("phase 3 — deterministic evaluation (no model)");
  assert(
    evaluateConditionDeterministically(
      condition({ from: "vendor.com", categories: ["Receipts"] }),
      context(),
    ).kind === "match",
    "static AND conditions match without a model",
  );
  assert(
    evaluateConditionDeterministically(
      condition({ from: "other.com", categories: ["Receipts"] }),
      context(),
    ).kind === "no-match",
    "a failing static clause short-circuits an AND condition",
  );
  assert(
    evaluateConditionDeterministically(
      condition({ logic: "OR", from: "other.com", subject: "Invoice" }),
      context(),
    ).kind === "match",
    "OR matches when any static clause matches",
  );
  assert(
    evaluateConditionDeterministically(condition(), context()).kind === "no-match",
    "a rule with no conditions never matches (no accidental catch-all)",
  );

  section("phase 3 — semantic conditions require the model only when needed");
  assert(
    evaluateConditionDeterministically(
      condition({ ai: "the email is an invoice", from: "other.com" }),
      context(),
    ).kind === "no-match",
    "a failed static clause avoids the semantic check entirely (AND)",
  );
  assert(
    evaluateConditionDeterministically(
      condition({ ai: "the email is an invoice", from: "vendor.com" }),
      context(),
    ).kind === "needs-ai",
    "a passing static clause defers to the semantic check",
  );
  assert(
    evaluateConditionDeterministically(
      condition({ ai: "urgent", logic: "OR", from: "vendor.com" }),
      context(),
    ).kind === "match",
    "an OR statically satisfied does not need the model",
  );
  assert(
    evaluateConditionDeterministically(
      condition({ logic: "AND", hasUnsubscribe: true }),
      context({ hasUnsubscribe: false }),
    ).kind === "no-match",
    "header flags are evaluated deterministically",
  );

  section("phase 3 — a rule never sends directly");
  assert(
    collectDraftInstruction([
      { type: "LABEL", fields: { label: "Receipts" } },
      { type: "SEND", fields: { instruction: "Confirm receipt." } },
    ]) === "Confirm receipt.",
    "SEND/DRAFT_REPLY only produce a draft instruction",
  );
  assert(
    collectDraftInstruction([{ type: "ARCHIVE", fields: {} }]) === null,
    "an action set with no reply produces no instruction",
  );
}
