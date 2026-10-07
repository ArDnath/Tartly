/**
 * Small, dependency-free helpers shared by the typed tool-result cards.
 *
 * Tool output is `unknown` at the UI boundary: it is model-facing server data
 * that must never be trusted to have the shape we expect. Every card narrows
 * defensively instead of casting.
 */

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function asBoolean(value: unknown): boolean {
  return value === true;
}

/**
 * Split an address from either a bare `user@host` or the `Name <user@host>`
 * form the read tools emit. Returns the display name separately from the
 * address so a mail header can typeset them differently, and falls back to the
 * raw string as the name when there is no angle-address to parse.
 */
export function parseMailAddress(value: unknown): {
  name?: string;
  email?: string;
} {
  const raw = asString(value);
  if (!raw) return {};
  const match = /^(.*?)\s*<([^>]+)>\s*$/.exec(raw);
  if (match) {
    const name = match[1].trim().replace(/^"(.*)"$/, "$1");
    return { name: name || match[2], email: match[2] };
  }
  return { name: raw, email: raw.includes("@") ? raw : undefined };
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Render an ISO timestamp compactly; fall back to nothing on bad input. */
export function formatTimestamp(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
