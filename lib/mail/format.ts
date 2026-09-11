/** Formatting helpers for the mail feature — address parsing, avatar
 * initials, and the two date shapes the list row and reader use. */

/** Split a comma/semicolon/newline-separated field into trimmed, non-empty
 * address tokens. Used both by the composer chips and the store. */
export function parseAddressList(input: string): string[] {
  return (input ?? "")
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** 1–2 letter initials from a display name or an email local-part. */
export function mailInitials(nameOrEmail: string): string {
  const source = (nameOrEmail ?? "").trim();
  if (!source) return "?";
  // For a bare email, initial off the local-part rather than the domain.
  const base =
    source.includes("@") && !source.includes(" ")
      ? source.slice(0, source.indexOf("@"))
      : source;
  const words = base.split(/[\s._-]+/).filter(Boolean);
  const letters =
    words.length >= 2
      ? words[0][0] + words[words.length - 1][0]
      : base.slice(0, 2);
  return letters.toUpperCase();
}

function parseDate(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Full date+time for the reader header and quoted-reply attribution. */
export function formatMailFullDate(iso: string): string {
  const date = parseDate(iso);
  if (!date) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Compact stamp for a list row: a clock if the message is from today,
 * otherwise a short date (year only when it isn't the current one). */
export function formatMailTime(iso: string): string {
  const date = parseDate(iso);
  if (!date) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
