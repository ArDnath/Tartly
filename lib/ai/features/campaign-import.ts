import "server-only";

import { z } from "zod";

import { generateObject } from "@/lib/ai/generate";

/**
 * Campaign column mapping (Phase 7).
 *
 * After an import parses headers, one `fast` call proposes which column is the
 * recipient email, name, company, unsubscribe, and which map to merge fields.
 * The model can never invent a column: `sanitizeMapping` drops anything not in
 * the header set, and there is a deterministic keyword fallback.
 */

export const CAMPAIGN_IMPORT_VERSION = "campaign-import-v1";

export type SuggestedMapping = {
  emailColumn: string | null;
  nameColumn: string | null;
  companyColumn: string | null;
  unsubscribeColumn: string | null;
  /** Merge-field name → column name. */
  custom: Record<string, string>;
};

const mappingSchema = z.object({
  emailColumn: z.string().max(120).nullable(),
  nameColumn: z.string().max(120).nullable(),
  companyColumn: z.string().max(120).nullable(),
  unsubscribeColumn: z.string().max(120).nullable(),
  custom: z.record(z.string().max(60), z.string().max(120)),
});

const SYSTEM = [
  "You map the columns of a spreadsheet to fields for a mail-merge campaign.",
  "Return a mapping using ONLY the exact column names provided.",
  "Choose the column most likely to contain each field; use null when unsure.",
  "The email column is required.",
].join(" ");

const EMAIL_HINTS = ["email", "e-mail", "e mail", "mail", "address", "contact"];
const NAME_HINTS = ["name", "first name", "full name", "contact", "firstname"];
const COMPANY_HINTS = ["company", "organization", "organisation", "org", "employer", "business"];
const UNSUB_HINTS = ["unsubscribe", "opt out", "opt-out", "optout", "consent", "subscribed"];

function findColumn(headers: string[], hints: string[]): string | null {
  const lower = headers.map((header) => header.toLowerCase().trim());
  // Exact match first, then substring, so "Email" beats "Backup email".
  for (const hint of hints) {
    const exact = lower.indexOf(hint);
    if (exact >= 0) return headers[exact]!;
  }
  for (const hint of hints) {
    const partial = lower.findIndex((header) => header.includes(hint));
    if (partial >= 0) return headers[partial]!;
  }
  return null;
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Deterministic mapping from header keywords (and sample rows for email). */
export function heuristicMapping(
  headers: string[],
  sampleRows: string[][] = [],
): SuggestedMapping {
  let emailColumn = findColumn(headers, EMAIL_HINTS);
  // If the hint is wrong, fall back to the column that actually holds addresses.
  const looksLikeEmail = (column: string | null): boolean => {
    if (!column) return false;
    const index = headers.indexOf(column);
    if (index < 0) return false;
    return sampleRows.some((row) => EMAIL_PATTERN.test((row[index] ?? "").trim()));
  };
  if (!looksLikeEmail(emailColumn)) {
    for (let index = 0; index < headers.length; index += 1) {
      if (sampleRows.some((row) => EMAIL_PATTERN.test((row[index] ?? "").trim()))) {
        emailColumn = headers[index]!;
        break;
      }
    }
  }

  const nameColumn = findColumn(headers, NAME_HINTS);
  const companyColumn = findColumn(headers, COMPANY_HINTS);
  const unsubscribeColumn = findColumn(headers, UNSUB_HINTS);

  const consumed = new Set(
    [emailColumn, nameColumn, companyColumn, unsubscribeColumn].filter(
      (value): value is string => Boolean(value),
    ),
  );
  const custom: Record<string, string> = {};
  for (const header of headers) {
    if (consumed.has(header)) continue;
    const key = header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (key) custom[key] = header;
  }

  return { emailColumn, nameColumn, companyColumn, unsubscribeColumn, custom };
}

/** Keep only columns that exist; never trust a model-invented header. */
export function sanitizeMapping(
  mapping: SuggestedMapping,
  headers: string[],
): SuggestedMapping {
  const valid = new Set(headers);
  const keep = (column: string | null): string | null =>
    column && valid.has(column) ? column : null;

  const custom: Record<string, string> = {};
  for (const [key, column] of Object.entries(mapping.custom ?? {})) {
    if (valid.has(column) && /^[a-z0-9_]+$/.test(key)) custom[key] = column;
  }

  return {
    emailColumn: keep(mapping.emailColumn),
    nameColumn: keep(mapping.nameColumn),
    companyColumn: keep(mapping.companyColumn),
    unsubscribeColumn: keep(mapping.unsubscribeColumn),
    custom,
  };
}

export async function suggestColumnMapping({
  userId,
  headers,
  sampleRows,
}: {
  userId: string;
  headers: string[];
  sampleRows: string[][];
}): Promise<{ mapping: SuggestedMapping; source: "model" | "heuristic" }> {
  const fallback = heuristicMapping(headers, sampleRows);
  if (headers.length === 0) return { mapping: fallback, source: "heuristic" };

  const ai = await generateObject({
    schema: mappingSchema,
    role: "fast",
    feature: "campaign-import",
    userId,
    system: SYSTEM,
    prompt: [
      `<columns>\n${headers.join("\n")}\n</columns>`,
      sampleRows.length
        ? `<sample_rows>\n${sampleRows
            .slice(0, 3)
            .map((row) => row.join(" | "))
            .join("\n")}\n</sample_rows>`
        : "",
      "Return the mapping.",
    ]
      .filter(Boolean)
      .join("\n"),
    hardening: { trust: "trusted" },
    maxOutputTokens: 500,
  });

  if (!ai) return { mapping: fallback, source: "heuristic" };
  const sanitized = sanitizeMapping(ai, headers);
  // A model that missed the required email column is worse than the heuristic.
  if (!sanitized.emailColumn) return { mapping: fallback, source: "heuristic" };
  return { mapping: sanitized, source: "model" };
}
