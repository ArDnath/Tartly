import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { autopilotDecisions } from "@/lib/db/schema";
import {
  AUTOPILOT_REASON_LABELS,
  autopilotReasonLabel,
} from "@/lib/settings/autopilot";

const ROOT = process.cwd();

function source(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("autopilot_decisions is content-free (INV-11 / T-06)", () => {
  it("has no message-content columns", () => {
    const columns = Object.keys(getTableColumns(autopilotDecisions));
    const forbidden = [
      "subject",
      "body",
      "bodyText",
      "bodyHtml",
      "snippet",
      "text",
      "accessToken",
      "refreshToken",
    ];
    for (const column of forbidden) {
      expect(columns).not.toContain(column);
    }
  });

  it("stores only IDs, reason codes and boolean checks", () => {
    const columns = new Set(Object.keys(getTableColumns(autopilotDecisions)));
    for (const expected of [
      "threadId",
      "runId",
      "draftId",
      "decision",
      "reason",
      "checks",
    ]) {
      expect(columns.has(expected)).toBe(true);
    }
  });
});

describe("the new code paths never emit message content (log scan)", () => {
  const files = [
    "lib/settings/autopilot.ts",
    "lib/settings/autopilot-usage.ts",
    "lib/settings/autopilot-preview.ts",
    "lib/engine/steps/egress.ts",
    "lib/repositories/autopilot.ts",
  ];

  it("does not log or persist a body/subject on the autopilot path", () => {
    for (const file of files) {
      const text = source(file);
      // No console.* that references a body/subject variable.
      expect(text).not.toMatch(/console\.[a-z]+\([^)]*\b(body|subject|bodyText)\b/);
      // No message content selected into an insertDecision/audit payload.
      expect(text).not.toMatch(
        /insertDecision\([^)]*\b(subject|bodyText|bodyHtml)\b/,
      );
    }
  });

  it("adds no model calls to the gate (INV-15)", () => {
    const egress = source("lib/engine/steps/egress.ts");
    expect(egress).not.toMatch(/from "@\/lib\/ai\/generate"/);
    expect(egress).not.toMatch(/generateObject|generateText|streamGenerate/);
  });
});

describe("gate reason labels (single source of truth)", () => {
  const reasons = [
    "autopilot",
    "autopilot_disabled_globally",
    "autopilot_disabled",
    "outside_window",
    "low_confidence",
    "category_not_allowed",
    "unknown_sender",
    "hour_cap",
    "day_cap",
    "thread_cap",
    "loop_detected",
    "autopilot_error",
  ];

  it("labels every static reason", () => {
    for (const reason of reasons) {
      expect(AUTOPILOT_REASON_LABELS[reason]).toBeTruthy();
    }
  });

  it("collapses every guardrails:* reason to one human label", () => {
    expect(autopilotReasonLabel("guardrails:commitment_language:money")).toBe(
      "Held for review: risky content",
    );
    expect(autopilotReasonLabel("guardrails:auto_responder:unreachable")).toBe(
      "Held for review: risky content",
    );
  });

  it("never returns the raw enum for an unknown reason", () => {
    expect(autopilotReasonLabel("something_new")).toBe("Held for review");
  });
});
