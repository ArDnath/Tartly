import { describe, expect, it } from "vitest";

import { publicOrigin, publicUrl } from "@/lib/http/public-origin";

/**
 * Regression guard for the production onboarding bug: the Next.js standalone
 * server binds to 0.0.0.0:3000, so `request.nextUrl.origin` resolves to
 * `https://0.0.0.0:3000` behind Caddy. Absolute redirects must always use the
 * canonical env origin instead.
 */
describe("publicOrigin", () => {
  it("returns the configured canonical origin", () => {
    // `tests/setup.ts` sets BETTER_AUTH_URL for the suite.
    expect(publicOrigin()).toBe("http://localhost:3000");
  });

  it("never returns the server bind address", () => {
    expect(publicOrigin()).not.toContain("0.0.0.0");
  });
});

describe("publicUrl", () => {
  it("builds absolute URLs on the canonical origin", () => {
    expect(publicUrl("/onboarding").toString()).toBe(
      "http://localhost:3000/onboarding",
    );
    expect(publicUrl("/mail?welcome=1").toString()).toBe(
      "http://localhost:3000/mail?welcome=1",
    );
  });
});
