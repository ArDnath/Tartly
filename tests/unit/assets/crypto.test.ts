import { describe, expect, it } from "vitest";

import { openText, sealText } from "@/lib/assets/crypto";

describe("assets/crypto", () => {
  it("round-trips text through AES-256-GCM", () => {
    const sealed = sealText("secret attachment text");
    expect(openText(sealed)).toBe("secret attachment text");
  });

  it("uses a fresh nonce per call and never stores plaintext", () => {
    const a = sealText("same input");
    const b = sealText("same input");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.ciphertext).not.toContain("same input");
  });

  it("rejects tampered ciphertext", () => {
    const sealed = sealText("tamper me");
    const tampered = {
      ...sealed,
      ciphertext: Buffer.from(
        Buffer.from(sealed.ciphertext, "base64").map((byte) => byte ^ 0xff),
      ).toString("base64"),
    };
    expect(() => openText(tampered)).toThrow();
  });

  it("rejects a malformed sealed payload", () => {
    expect(() => openText({ ciphertext: "x", iv: "y", tag: "z" })).toThrow();
  });
});
