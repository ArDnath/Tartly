import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

import {
  assertSafeOutboundUrl,
  isBlockedHostname,
  isPrivateAddress,
  SsrfBlockedError,
} from "@/lib/security/ssrf";

describe("isPrivateAddress", () => {
  it("flags loopback, private, link-local and reserved IPv4", () => {
    for (const ip of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.1",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("flags loopback, ULA, link-local, multicast and mapped IPv6", () => {
    for (const ip of [
      "::",
      "::1",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
      "::ffff:7f00:1",
      "64:ff9b::7f00:1",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("allows public IPv6 and fails closed on non-IPs", () => {
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });
});

describe("isBlockedHostname", () => {
  it("blocks reserved names and private literals", () => {
    for (const host of [
      "localhost",
      "localhost.localdomain",
      "metadata",
      "metadata.google.internal",
      "db.internal",
      "printer.local",
      "service.home.arpa",
      "127.0.0.1",
      "169.254.169.254",
      "[::1]",
      "[::ffff:127.0.0.1]",
      "",
    ]) {
      expect(isBlockedHostname(host), host).toBe(true);
    }
  });

  it("allows ordinary public hosts", () => {
    for (const host of ["example.com", "api.github.com", "8.8.8.8", "93.184.216.34"]) {
      expect(isBlockedHostname(host), host).toBe(false);
    }
  });
});

describe("assertSafeOutboundUrl", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it("rejects non-http(s) schemes", async () => {
    await expect(assertSafeOutboundUrl("ftp://example.com/")).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    await expect(assertSafeOutboundUrl("file:///etc/passwd")).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it("rejects private and metadata literals, including obfuscated IPv4", async () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://2130706433/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://localhost:3000/",
      "http://metadata.google.internal/",
    ]) {
      await expect(assertSafeOutboundUrl(url), url).rejects.toBeInstanceOf(
        SsrfBlockedError,
      );
    }
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("accepts a public IP literal without resolving DNS", async () => {
    const url = await assertSafeOutboundUrl("https://93.184.216.34/page");
    expect(url.hostname).toBe("93.184.216.34");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("accepts a hostname that resolves only to public addresses", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
    const url = await assertSafeOutboundUrl("https://example.com/page");
    expect(url.hostname).toBe("example.com");
    expect(lookupMock).toHaveBeenCalledWith("example.com", { all: true });
  });

  it("rejects a hostname that resolves to a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expect(
      assertSafeOutboundUrl("https://internal.example.com/"),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("rejects a hostname that cannot be resolved", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(
      assertSafeOutboundUrl("https://nope.invalid/"),
    ).rejects.toBeInstanceOf(SsrfBlockedError);

    lookupMock.mockResolvedValue([]);
    await expect(
      assertSafeOutboundUrl("https://empty.example.com/"),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});
