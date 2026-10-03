import { describe, expect, it } from "vitest";

import {
  buildCsp,
  CSP_HEADER,
  CSP_REPORT_ONLY_HEADER,
  cspHeaderName,
  parseCspMode,
} from "@/lib/security/csp";

const NONCE = "dGVzdC1ub25jZS12YWx1ZQ==";

function directives(policy: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of policy.split(";")) {
    const [name, ...rest] = part.trim().split(/\s+/);
    if (name) out[name] = rest.join(" ");
  }
  return out;
}

describe("parseCspMode", () => {
  it("defaults to enforce when unset or unrecognized", () => {
    expect(parseCspMode(undefined)).toBe("enforce");
    expect(parseCspMode("")).toBe("enforce");
    expect(parseCspMode("loud")).toBe("enforce");
  });

  it("passes through the explicit modes", () => {
    expect(parseCspMode("off")).toBe("off");
    expect(parseCspMode("report")).toBe("report");
    expect(parseCspMode("enforce")).toBe("enforce");
  });
});

describe("cspHeaderName", () => {
  it("uses the enforcing header only in enforce mode", () => {
    expect(cspHeaderName("enforce")).toBe(CSP_HEADER);
    expect(cspHeaderName("report")).toBe(CSP_REPORT_ONLY_HEADER);
  });
});

describe("buildCsp", () => {
  it("binds script-src to the per-request nonce and blocks the injection pivots", () => {
    const csp = directives(buildCsp({ nonce: NONCE, isDev: false }));

    expect(csp["script-src"]).toContain(`'nonce-${NONCE}'`);
    expect(csp["script-src"]).toContain("'strict-dynamic'");
    // Rive compiles WebAssembly.
    expect(csp["script-src"]).toContain("'wasm-unsafe-eval'");
    expect(csp["object-src"]).toBe("'none'");
    expect(csp["base-uri"]).toBe("'self'");
    expect(csp["frame-ancestors"]).toBe("'none'");
    expect(csp["form-action"]).toBe("'self'");
    expect(csp["worker-src"]).toBe("'self' blob:");
  });

  it("allows the object-storage and avatar origins the browser hits directly", () => {
    const csp = directives(buildCsp({ nonce: NONCE, isDev: false }));

    expect(csp["connect-src"]).toContain("https://*.blob.vercel-storage.com");
    expect(csp["img-src"]).toContain("https://*.blob.vercel-storage.com");
    expect(csp["img-src"]).toContain("https://*.googleusercontent.com");
    expect(csp["media-src"]).toContain("blob:");
    expect(csp["font-src"]).toBe("'self' data:");
  });

  it("relaxes eval and the HMR socket only in development", () => {
    const prod = directives(buildCsp({ nonce: NONCE, isDev: false }));
    const dev = directives(buildCsp({ nonce: NONCE, isDev: true }));

    expect(prod["script-src"]).not.toContain("'unsafe-eval'");
    expect(dev["script-src"]).toContain("'unsafe-eval'");

    expect(prod["connect-src"]).not.toContain("ws:");
    expect(dev["connect-src"]).toContain("ws:");

    // Upgrading a local http origin to https would break dev.
    expect(prod).toHaveProperty("upgrade-insecure-requests");
    expect(dev).not.toHaveProperty("upgrade-insecure-requests");
  });

  it("appends an optional report-uri sink", () => {
    const csp = buildCsp({
      nonce: NONCE,
      isDev: false,
      reportUri: "/api/csp-report",
    });
    expect(directives(csp)["report-uri"]).toBe("/api/csp-report");

    expect(directives(buildCsp({ nonce: NONCE, isDev: false }))).not.toHaveProperty(
      "report-uri",
    );
  });

  it("keeps style attributes working while style elements stay nonce-bound", () => {
    const csp = directives(buildCsp({ nonce: NONCE, isDev: false }));
    // React style={{…}} attributes cannot carry a nonce.
    expect(csp["style-src-attr"]).toContain("'unsafe-inline'");
    // Inline <style> elements must be nonced; the blanket allowance is gone.
    expect(csp["style-src-elem"]).toContain(`'nonce-${NONCE}'`);
    expect(csp["style-src-elem"]).toContain("'self'");
    expect(csp["style-src-elem"]).not.toContain("'unsafe-inline'");
    // Level-2 fallback; scripts stay nonce-bound.
    expect(csp["style-src"]).toBe("'self'");
    expect(csp["script-src"]).not.toContain("'unsafe-inline'");
  });
});
