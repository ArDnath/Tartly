/**
 * W3C Trace Context propagation (Phase D5).
 *
 * The `traceparent` header is the lowest-common-denominator correlation
 * primitive: parsing it lets this service join an upstream trace (a gateway,
 * another service, or an OpenTelemetry-instrumented caller) without pulling in
 * the full SDK. The `trace_id` flows into every structured log line so a
 * request can be followed across systems.
 *
 * Format: `version-trace-id-parent-id-trace-flags`
 * e.g. `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`
 */

export type TraceParent = {
  /** 32 lowercase hex chars, never all zero. */
  traceId: string;
  /** 16 lowercase hex chars, never all zero. */
  parentId: string;
  /** 8-bit flags; bit 0 is `sampled`. */
  flags: number;
};

const TRACEPARENT_PATTERN =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

const ZERO_TRACE = /^0{32}$/;
const ZERO_PARENT = /^0{16}$/;

/**
 * Parses a `traceparent` header. Returns null for anything malformed or for the
 * spec's invalid all-zero ids, so a hostile header can never forge a trace.
 */
export function parseTraceparent(
  header: string | null | undefined,
): TraceParent | null {
  if (!header) return null;
  const match = TRACEPARENT_PATTERN.exec(header.trim().toLowerCase());
  if (!match) return null;
  const traceId = match[2]!;
  const parentId = match[3]!;
  if (ZERO_TRACE.test(traceId) || ZERO_PARENT.test(parentId)) return null;
  return {
    traceId,
    parentId,
    flags: Number.parseInt(match[4]!, 16),
  };
}

/** Serializes a trace context for an outbound `traceparent` header. */
export function formatTraceparent(input: {
  traceId: string;
  spanId: string;
  flags?: number;
}): string {
  const flags = (input.flags ?? 1).toString(16).padStart(2, "0").slice(-2);
  return `00-${input.traceId}-${input.spanId}-${flags}`;
}
