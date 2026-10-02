import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison for secrets (API tokens, signatures, shared
 * keys). `===` short-circuits on the first differing byte, which leaks how many
 * leading characters an attacker guessed correctly.
 *
 * Length is compared first and is not itself secret; only equal-length inputs
 * reach `timingSafeEqual`, which throws on a length mismatch.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
