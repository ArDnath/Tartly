import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF guard for outbound URLs that are not fully trusted.
 *
 * Two surfaces in this codebase fetch a URL an attacker can influence:
 *
 *  - `open_web_page` fetches a URL chosen by the model from untrusted email
 *    content (prompt injection), and
 *  - one-click unsubscribe POSTs to the `List-Unsubscribe` URL from an inbound
 *    message header (an attacker can put anything there).
 *
 * Both must never reach loopback, private, link-local or cloud-metadata
 * addresses. This module is the single choke point: it rejects non-http(s)
 * schemes, blocked hostnames, IP literals in private/reserved ranges (the
 * WHATWG URL parser normalizes obfuscated IPv4 such as `2130706433` first), and
 * public hostnames whose DNS records resolve to a private address.
 *
 * It is deliberately dependency-light and pure enough to unit test. DNS
 * resolution is the one async step; a rebinding race is not eliminated, but the
 * resolved-address check closes the common `internal.corp` / `localhost` case.
 */

export class SsrfBlockedError extends Error {
  constructor(message = "That address is not allowed.") {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

/** Exact hostnames that must never be fetched. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

/** Suffixes reserved for private/internal networks. */
const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
  ".in-addr.arpa",
  ".ip6.arpa",
];

/** True when a hostname is a blocked literal or reserved internal name. */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.$/, "");
  if (host.length === 0) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (isIP(host) !== 0) return isPrivateAddress(host);
  return false;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 88 && parts[2] === 99) return true; // 192.88.99.0/24 6to4
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
  if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  // IPv4-mapped (`::ffff:7f00:1`) and NAT64 (`64:ff9b::`) embed an IPv4 address.
  const mapped = /^::ffff:(.+)$/.exec(lower);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (lower.startsWith("64:ff9b:")) return true;

  if (lower === "::" || lower === "::1") return true; // unspecified + loopback

  const first = lower.split(":")[0] ?? "";
  const value = Number.parseInt(first || "0", 16);
  if (!Number.isFinite(value)) return true; // unparseable → block
  if ((value & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if ((value & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((value & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if (first === "2001" && lower.startsWith("2001:db8:")) return true; // docs
  return false;
}

/** True when an IP literal is in a private, loopback, link-local or reserved range. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true; // not an IP literal: fail closed
}

function hostnameOf(url: URL): string {
  return url.hostname.replace(/^\[/, "").replace(/\]$/, "");
}

/**
 * Validate that a URL is safe to fetch server-side. Returns the parsed `URL`
 * when safe; throws {@link SsrfBlockedError} otherwise. Non-IP hostnames are
 * DNS-resolved and every returned address is checked.
 */
export async function assertSafeOutboundUrl(
  raw: string | URL,
): Promise<URL> {
  let url: URL;
  try {
    url = raw instanceof URL ? raw : new URL(raw);
  } catch {
    throw new SsrfBlockedError("That is not a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError("Only http(s) URLs can be fetched.");
  }

  const host = hostnameOf(url);
  if (isBlockedHostname(host)) {
    throw new SsrfBlockedError("That host is not allowed.");
  }
  if (isIP(host) !== 0) return url;

  const records = await lookup(host, { all: true }).catch(() => []);
  if (records.length === 0) {
    throw new SsrfBlockedError("That host could not be resolved.");
  }
  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      throw new SsrfBlockedError("That host resolves to a private address.");
    }
  }
  return url;
}
