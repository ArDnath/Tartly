import { describe, expect, it } from "vitest";

import { parseClamavReply, scanBlocked } from "@/lib/assets/scan";

describe("assets/scan", () => {
  it("parses a clean clamd reply", () => {
    expect(parseClamavReply("stream: OK\0")).toMatchObject({
      verdict: "clean",
      signature: null,
      scanner: "clamav",
    });
  });

  it("parses an infected reply and extracts the signature", () => {
    expect(parseClamavReply("stream: Eicar-Test-Signature FOUND\0")).toMatchObject({
      verdict: "infected",
      signature: "Eicar-Test-Signature",
    });
  });

  it("treats an unexpected reply as an error, not a pass", () => {
    expect(parseClamavReply("INSTREAM size limit exceeded. ERROR\0")).toMatchObject({
      verdict: "error",
      scanner: "clamav",
    });
    expect(parseClamavReply("").verdict).toBe("error");
  });

  it("blocks non-clean verdicts only under enforce mode", () => {
    const infected = {
      verdict: "infected" as const,
      signature: "X",
      scanner: "clamav",
      detail: null,
    };
    const clean = {
      verdict: "clean" as const,
      signature: null,
      scanner: "clamav",
      detail: null,
    };
    const errored = {
      verdict: "error" as const,
      signature: null,
      scanner: "clamav",
      detail: "timeout",
    };

    expect(scanBlocked(infected, "off")).toBe(false);
    expect(scanBlocked(infected, "warn")).toBe(false);
    expect(scanBlocked(infected, "enforce")).toBe(true);
    expect(scanBlocked(errored, "enforce")).toBe(true);
    expect(scanBlocked(clean, "enforce")).toBe(false);
  });
});
