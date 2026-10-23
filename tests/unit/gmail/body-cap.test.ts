import { describe, expect, it } from "vitest";

import {
  MAX_STORED_BODY_HTML_CHARS,
  MAX_STORED_BODY_TEXT_CHARS,
  capStoredBodies,
} from "@/lib/gmail/body";

describe("capStoredBodies", () => {
  it("leaves ordinary messages untouched", () => {
    const text = "Short message.";
    const html = "<p>Short message.</p>";
    expect(capStoredBodies({ text, html })).toEqual({ text, html });
  });

  it("keeps null html null", () => {
    expect(capStoredBodies({ text: "plain", html: null }).html).toBeNull();
  });

  it("caps plain text and marks the truncation", () => {
    const line = "x".repeat(100);
    const text = Array.from({ length: 2000 }, () => line).join("\n");
    const capped = capStoredBodies({ text, html: null }).text;

    expect(text.length).toBeGreaterThan(MAX_STORED_BODY_TEXT_CHARS);
    expect(capped.length).toBeLessThanOrEqual(
      MAX_STORED_BODY_TEXT_CHARS + 40,
    );
    expect(capped.endsWith("[... message truncated ...]")).toBe(true);
  });

  it("cuts html on a tag boundary, never mid-attribute", () => {
    const block = `<p>${"y".repeat(200)}</p>`;
    const html = Array.from({ length: 1000 }, () => block).join("");
    const capped = capStoredBodies({ text: "", html }).html!;

    expect(html.length).toBeGreaterThan(MAX_STORED_BODY_HTML_CHARS);
    expect(capped.length).toBeLessThanOrEqual(
      MAX_STORED_BODY_HTML_CHARS + 40,
    );
    expect(capped).toContain("<!-- tartly:truncated -->");
    // The last meaningful character before the marker is a closed tag.
    const beforeMarker = capped.slice(
      0,
      capped.indexOf("<!-- tartly:truncated -->"),
    );
    expect(beforeMarker.trimEnd().endsWith(">")).toBe(true);
  });

  it("falls back to an exact cut when there is no boundary", () => {
    const html = `<p>${"z".repeat(MAX_STORED_BODY_HTML_CHARS * 2)}</p>`;
    const capped = capStoredBodies({ text: "", html }).html!;
    expect(capped.length).toBeGreaterThan(MAX_STORED_BODY_HTML_CHARS);
    expect(capped).toContain("<!-- tartly:truncated -->");
  });
});
