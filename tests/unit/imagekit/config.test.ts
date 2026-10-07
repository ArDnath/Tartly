import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getImageKitUrlEndpoint,
  isImageKitConfigured,
  shouldRenderWithImageKit,
} from "@/lib/imagekit/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ImageKit config", () => {
  it("normalizes a trailing slash off the endpoint", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT",
      "https://ik.imagekit.io/tartly/",
    );

    expect(getImageKitUrlEndpoint()).toBe("https://ik.imagekit.io/tartly");
    expect(isImageKitConfigured()).toBe(true);
  });

  it("treats a blank endpoint as unconfigured", () => {
    vi.stubEnv("NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT", "");

    expect(getImageKitUrlEndpoint()).toBe("");
    expect(isImageKitConfigured()).toBe(false);
    expect(shouldRenderWithImageKit("/tartly-hero.png")).toBe(false);
  });

  it("only routes to ImageKit when configured and src is non-empty", () => {
    vi.stubEnv("NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT", "https://ik.imagekit.io/demo");

    expect(shouldRenderWithImageKit("/tartly-hero.png")).toBe(true);
    expect(shouldRenderWithImageKit("https://example.com/x.png")).toBe(true);
    expect(shouldRenderWithImageKit("   ")).toBe(false);
    expect(shouldRenderWithImageKit("")).toBe(false);
    expect(shouldRenderWithImageKit(undefined)).toBe(false);
  });
});
