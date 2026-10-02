/**
 * Campaign template engine (Phase 7).
 *
 * Two substitutions, deliberately separated:
 *   - **Merge fields** (`{{name}}`, `{{company}}`, any spreadsheet column) are
 *     filled deterministically from the row. Cheap, free, batched by nothing.
 *   - **AI blocks** (`{{AI: write a one-line opener about {{company}}}}`) are
 *     filled by one batched model call per chunk. If the model is unavailable,
 *     an AI block is *dropped* — never sent as garbled braces.
 *
 * Pure module: no provider, no DB, so the eval can assert the exact contract.
 */

export type MergeField = { raw: string; key: string; index: number };
export type AiBlock = { raw: string; instruction: string; index: number };

const MERGE_FIELD_PATTERN = /\{\{\s*([a-zA-Z0-9_ .-]+?)\s*\}\}/g;

type AiSpan = { start: number; end: number; instruction: string };

/**
 * Find `{{AI: … }}` spans with balanced braces, so an instruction may itself
 * contain merge fields (`{{AI: reference {{company}}}}`). A simple lazy regex
 * would stop at the inner `}}` and leave a stray brace, so this scans depth.
 */
function findAiSpans(template: string): AiSpan[] {
  const spans: AiSpan[] = [];
  const lower = template.toLowerCase();
  let cursor = 0;

  while (cursor < template.length) {
    const start = lower.indexOf("{{ai:", cursor);
    if (start < 0) break;

    let depth = 1;
    let index = start + 2;
    let end = -1;
    while (index < template.length - 1) {
      if (template[index] === "{" && template[index + 1] === "{") {
        depth += 1;
        index += 2;
        continue;
      }
      if (template[index] === "}" && template[index + 1] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
        index += 2;
        continue;
      }
      index += 1;
    }
    if (end < 0) break;

    const raw = template.slice(start, end + 2);
    spans.push({
      start,
      end: end + 2,
      instruction: raw.slice(5, raw.length - 2).trim(),
    });
    cursor = end + 2;
  }

  return spans;
}

/** Remove every AI span so merge-field extraction ignores instruction internals. */
function withoutAiSpans(template: string): string {
  const spans = findAiSpans(template);
  if (spans.length === 0) return template;
  let output = "";
  let cursor = 0;
  for (const span of spans) {
    output += template.slice(cursor, span.start);
    cursor = span.end;
  }
  return output + template.slice(cursor);
}

/** Merge fields in order of appearance, excluding `{{AI: …}}` blocks. */
export function extractMergeFields(template: string): MergeField[] {
  const withoutAi = withoutAiSpans(template);
  const fields: MergeField[] = [];
  for (const match of withoutAi.matchAll(MERGE_FIELD_PATTERN)) {
    fields.push({
      raw: match[0],
      key: match[1]!.trim().toLowerCase(),
      index: match.index ?? 0,
    });
  }
  return fields;
}

export function extractAiBlocks(template: string): AiBlock[] {
  return findAiSpans(template).map((span, index) => ({
    raw: template.slice(span.start, span.end),
    instruction: span.instruction,
    index,
  }));
}

export function hasAiBlocks(template: string): boolean {
  return findAiSpans(template).length > 0;
}

/** Case-insensitive lookup of a merge key in a row's data. */
export function resolveMergeValue(
  key: string,
  data: Record<string, string | null | undefined>,
): string {
  const direct = data[key];
  if (direct != null) return String(direct).trim();
  const lower = key.toLowerCase();
  for (const [candidate, value] of Object.entries(data)) {
    if (candidate.toLowerCase() === lower && value != null) return String(value).trim();
  }
  return "";
}

/**
 * Fill a template. `aiValues` maps an AI block index to its generated text;
 * blocks without a value are removed. Merge fields without a value become an
 * empty string (never a stray `{{…}}`).
 */
export function renderTemplate({
  template,
  data,
  aiValues = {},
}: {
  template: string;
  data: Record<string, string | null | undefined>;
  aiValues?: Record<number, string>;
}): string {
  const spans = findAiSpans(template);
  let output = "";
  let cursor = 0;
  spans.forEach((span, index) => {
    output += template.slice(cursor, span.start);
    const value = aiValues[index];
    output += value != null ? value : "";
    cursor = span.end;
  });
  output += template.slice(cursor);

  output = output.replace(MERGE_FIELD_PATTERN, (_raw, key: string) =>
    resolveMergeValue(key.trim(), data),
  );

  // Tidy the empty lines a dropped block can leave behind.
  return output
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Deterministic rendering with every AI block dropped (the fallback path). */
export function renderTemplateWithoutAi({
  template,
  data,
}: {
  template: string;
  data: Record<string, string | null | undefined>;
}): string {
  return renderTemplate({ template, data });
}

/**
 * Build the pre-send HTML. Inline images append `cid:` refs below the text, the
 * same convention the composer uses.
 */
export function buildCampaignBody(text: string, inlineCids: string[]): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p>${paragraph
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br>")}</p>`,
    )
    .join("\n");
  const images = inlineCids.map((cid) => `<p><img src="cid:${cid}" alt="" /></p>`).join("");
  return `<div>${paragraphs}${images}</div>`;
}
