import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import { THEME_INIT_SCRIPT } from "@/lib/theme-init";
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

  it("hash-pins the pre-paint theme bootstrap instead of noncing it", () => {
    const csp = directives(buildCsp({ nonce: NONCE, isDev: false }));
    const hash = createHash("sha256")
      .update(THEME_INIT_SCRIPT, "utf8")
      .digest("base64");

    // The root layout renders THEME_INIT_SCRIPT verbatim; the policy must
    // authorize exactly those bytes even though the element has no nonce.
    expect(csp["script-src"]).toContain(`'sha256-${hash}'`);
    // The hash is narrow: inline scripts are still not blanket-allowed.
    expect(csp["script-src"]).not.toContain("'unsafe-inline'");
  });

  it("allows the object-storage and avatar origins the browser hits directly", () => {
    const csp = directives(buildCsp({ nonce: NONCE, isDev: false }));

    expect(csp["connect-src"]).toContain("https://*.blob.vercel-storage.com");
    expect(csp["img-src"]).toContain("https://*.blob.vercel-storage.com");
    expect(csp["img-src"]).toContain("https://*.googleusercontent.com");
    expect(csp["media-src"]).toContain("blob:");
    expect(csp["font-src"]).toBe("'self' data:");
  });

  it("allows remote email images inside the mail frame", () => {
    // A srcdoc mail frame inherits this policy; without the schemes every
    // image a newsletter references is blocked.
    const csp = directives(buildCsp({ nonce: NONCE, isDev: false }));
    expect(csp["img-src"]).toContain("https:");
    expect(csp["img-src"]).toContain("http:");
  });

  it("allows ImageKit media by default and a custom endpoint origin", () => {
    const fallback = directives(buildCsp({ nonce: NONCE, isDev: false }));
    expect(fallback["img-src"]).toContain("https://ik.imagekit.io");
    expect(fallback["media-src"]).toContain("https://*.imagekit.io");
    expect(fallback["connect-src"]).toContain("https://ik.imagekit.io");

    const custom = directives(
      buildCsp({
        nonce: NONCE,
        isDev: false,
        imagekitOrigin: "https://media.tartly.app",
      }),
    );
    expect(custom["img-src"]).toContain("https://media.tartly.app");
    expect(custom["media-src"]).toContain("https://media.tartly.app");
    expect(custom["connect-src"]).toContain("https://media.tartly.app");
  });

  it("allows the browser's direct object-store upload origin in connect-src", () => {
    const csp = directives(
      buildCsp({
        nonce: NONCE,
        isDev: false,
        assetStorageOrigin: "https://account.r2.cloudflarestorage.com",
      }),
    );
    expect(csp["connect-src"]).toContain("https://account.r2.cloudflarestorage.com");
    // Reads are proxied by the app; the bucket must not be an image/media source.
    expect(csp["img-src"]).not.toContain("https://account.r2.cloudflarestorage.com");
    expect(csp["media-src"]).not.toContain("https://account.r2.cloudflarestorage.com");

    // Blob-only / unconfigured deployments keep the narrower policy.
    expect(directives(buildCsp({ nonce: NONCE, isDev: false }))["connect-src"]).not.toContain(
      "cloudflarestorage.com",
    );
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

  it("allows nonce-less runtime styles in development only", () => {
    const dev = directives(buildCsp({ nonce: NONCE, isDev: true }));

    // A nonce would make browsers ignore 'unsafe-inline', so dev drops it —
    // otherwise React/dev-overlay/font styles injected at runtime are blocked.
    expect(dev["style-src-elem"]).toContain("'unsafe-inline'");
    expect(dev["style-src-elem"]).not.toContain(`'nonce-${NONCE}'`);
    // The CSP2 fallback must relax too.
    expect(dev["style-src"]).toContain("'unsafe-inline'");
    // Scripts stay nonce-bound even in dev.
    expect(dev["script-src"]).toContain(`'nonce-${NONCE}'`);
  });
});
