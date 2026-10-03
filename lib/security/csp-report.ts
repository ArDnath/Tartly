import "server-only";

/**
 * CSP violation-report normalization (Phase C6).
 *
 * Browsers emit two shapes and both must be accepted:
 *  - `report-uri` (legacy, what we emit today): `{ "csp-report": { … } }`
 *  - `report-to` (Reporting API): an array of `{ type, body: { … } }`
 *
 * Reports arrive from untrusted pages, so this module deliberately narrows every
 * field to a safe, loggable primitive: document URLs become **paths** (a query
 * string could carry a token) and blocked URLs become **origins** (the useful
 * bit for widening an allowlist). Anything unexpected is dropped rather than
 * logged.
 */

export type CspViolation = {
  /** Path of the page that reported, e.g. `/mail`. */
  document_path?: string;
  /** Origin (or `data:`/`blob:`/`self`) of the blocked resource. */
  blocked_origin?: string;
  violated_directive?: string;
  effective_directive?: string;
  disposition?: string;
};

type RawReport = Record<string, unknown>;

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function documentPath(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  try {
    return new URL(uri, "https://placeholder.invalid").pathname;
  } catch {
    return undefined;
  }
}

function blockedOrigin(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  if (uri === "self") return "self";
  if (uri.startsWith("data:")) return "data:";
  if (uri.startsWith("blob:")) return "blob:";
  if (uri.startsWith("about:")) return "about:";
  try {
    return new URL(uri).origin;
  } catch {
    // A relative URL means the browser considered it same-origin.
    return "self";
  }
}

function collectRawReports(payload: unknown): RawReport[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const body = (entry as RawReport).body;
      return body && typeof body === "object" ? [body as RawReport] : [entry as RawReport];
    });
  }
  if (payload && typeof payload === "object") {
    const single = (payload as RawReport)["csp-report"];
    if (single && typeof single === "object") return [single as RawReport];
  }
  return [];
}

/** Parse any CSP report body into normalized, safe violations. */
export function parseCspReports(payload: unknown): CspViolation[] {
  return collectRawReports(payload)
    .map((report) => ({
      document_path: documentPath(asString(report["document-uri"])),
      blocked_origin: blockedOrigin(asString(report["blocked-uri"])),
      violated_directive: asString(report["violated-directive"]),
      effective_directive: asString(report["effective-directive"]),
      disposition: asString(report.disposition),
    }))
    .filter((violation) => Boolean(violation.violated_directive || violation.blocked_origin));
}
