import { describe, expect, it } from "vitest";

import {
  applyStyleNonce,
  hasLightBackground,
  promoteLazyImages,
  rewriteInlineImages,
} from "@/lib/mail/render-email";

describe("applyStyleNonce", () => {
  it("tags every style element with the nonce", () => {
    const html =
      '<head><style>body{background:#fff}</style></head><body><style>.x{}</style></body>';
    const out = applyStyleNonce(html, "abc123");
    expect(out.match(/<style nonce="abc123"/g)).toHaveLength(2);
  });

  it("does not match style-like tag names and is a no-op without a nonce", () => {
    expect(applyStyleNonce("<p>no styles</p>", "abc")).toBe("<p>no styles</p>");
    // `\b` stops `<stylesheet` from being rewritten into `<style nonce=...sheet`.
    expect(applyStyleNonce("<stylesheet>", "abc")).toBe("<stylesheet>");
  });
});

describe("promoteLazyImages", () => {
  it("promotes a data-src over an empty or spacer src", () => {
    expect(
      promoteLazyImages('<img src="" data-src="https://cdn.example.com/a.png">'),
    ).toContain('src="https://cdn.example.com/a.png"');

    const spacer =
      '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="https://cdn.example.com/b.png">';
    expect(promoteLazyImages(spacer)).toContain(
      'src="https://cdn.example.com/b.png"',
    );
  });

  it("keeps a real src even when data-src is present", () => {
    const html =
      '<img src="https://cdn.example.com/real.png" data-src="https://cdn.example.com/lazy.png">';
    expect(promoteLazyImages(html)).toContain(
      'src="https://cdn.example.com/real.png"',
    );
  });

  it("promotes data-srcset into srcset", () => {
    const html =
      '<img src="" data-srcset="https://cdn.example.com/a.png 1x, https://cdn.example.com/b.png 2x">';
    expect(promoteLazyImages(html)).toContain(
      'srcset="https://cdn.example.com/a.png 1x, https://cdn.example.com/b.png 2x"',
    );
  });

  it("is a no-op when nothing is lazy", () => {
    const html = '<img src="https://cdn.example.com/a.png" alt="a">';
    expect(promoteLazyImages(html)).toBe(html);
  });
});

describe("rewriteInlineImages", () => {
  it("replaces cid references in src and CSS url()", () => {
    const urls = new Map([["logo@01D", "/api/v1/mail/attachments?x=1"]]);
    const html =
      '<img src="cid:logo@01D"><div style="background:url(cid:logo@01D)">';
    const out = rewriteInlineImages(html, urls);
    expect(out).not.toContain("cid:logo@01D");
    expect(out).toContain('src="/api/v1/mail/attachments?x=1"');
    expect(out).toContain("url(/api/v1/mail/attachments?x=1)");
  });

  it("leaves an unknown cid untouched", () => {
    const html = '<img src="cid:missing@01D">';
    expect(rewriteInlineImages(html, new Map())).toBe(html);
    expect(
      rewriteInlineImages(html, new Map([["other@01D", "/x"]])),
    ).toBe(html);
  });
});

describe("hasLightBackground", () => {
  it("detects light backgrounds in hex, rgb and named forms", () => {
    expect(hasLightBackground('<body style="background:#ffffff">')).toBe(true);
    expect(hasLightBackground('<table bgcolor="#fff">')).toBe(true);
    expect(hasLightBackground('<td style="background-color: rgb(250,250,250)">')).toBe(
      true,
    );
    expect(hasLightBackground("<style>.x{background:white}</style>")).toBe(true);
  });

  it("reports false for dark or absent backgrounds", () => {
    expect(hasLightBackground("<p>just text</p>")).toBe(false);
    expect(hasLightBackground('<div style="background:#111111">')).toBe(false);
    expect(hasLightBackground('<div style="color:#000000">')).toBe(false);
  });
});
