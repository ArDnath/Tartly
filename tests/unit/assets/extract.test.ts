import { describe, expect, it } from "vitest";

import {
  canExtract,
  extractText,
  htmlToPlainText,
} from "@/lib/assets/extract";

describe("assets/extract", () => {
  it("strips tags, scripts, and decodes entities from HTML", () => {
    const html =
      "<html><head><style>p{color:red}</style><script>alert(1)</script></head>" +
      "<body><h1>T&amp;C</h1><p>Hello&nbsp;<b>world</b></p></body></html>";
    const text = htmlToPlainText(html);
    expect(text).toContain("T&C");
    expect(text).toContain("Hello world");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color:red");
  });

  it("extracts plain text and JSON verbatim", () => {
    expect(extractText(Buffer.from("  hi there  "), "text/plain")).toEqual({
      text: "hi there",
      parser: "text/plain",
    });
    expect(
      extractText(Buffer.from('{"a":1}'), "application/json; charset=utf-8"),
    ).toEqual({ text: '{"a":1}', parser: "application/json" });
  });

  it("returns null for unsupported binary formats", () => {
    expect(extractText(Buffer.from([0xff, 0xd8]), "image/jpeg")).toBeNull();
    expect(canExtract("image/jpeg")).toBe(false);
    expect(canExtract("text/csv")).toBe(true);
  });
});
