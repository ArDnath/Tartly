import "server-only";

import { env } from "@/lib/env";

import type {
  WebPage,
  WebSearchAdapter,
  WebSearchHit,
  WebSearchResponse,
} from "./types";

/**
 * Tavily search adapter.
 *
 * Deliberately thin: it maps Tavily's response into our shapes and refuses to
 * invent fields the provider did not send. `isConfigured()` is false without a
 * key, so the research tools degrade to "not configured" instead of throwing a
 * provider error at the model.
 */

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const OPERATOR_TIMEOUT_MS = 15_000;
const MAX_PAGE_CHARS = 8_000;

type TavilyResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  raw_content?: unknown;
  score?: unknown;
  published_date?: unknown;
};

function toHit(raw: TavilyResult): WebSearchHit | null {
  if (typeof raw.url !== "string" || !raw.url.startsWith("http")) return null;
  const score =
    typeof raw.score === "number" && Number.isFinite(raw.score)
      ? Math.min(Math.max(raw.score, 0), 1)
      : undefined;
  const publishedAt =
    typeof raw.published_date === "string" ? raw.published_date : undefined;
  return {
    title:
      typeof raw.title === "string" && raw.title.trim()
        ? raw.title.trim()
        : raw.url,
    url: raw.url,
    snippet: typeof raw.content === "string" ? raw.content.trim() : "",
    ...(publishedAt ? { publishedAt } : {}),
    ...(score !== undefined ? { score } : {}),
  };
}

/** A conservative HTML-to-text for `open_web_page`; scripts/styles dropped. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function createTavilyAdapter(
  apiKey: string | undefined = env.SEARCH_API_KEY,
): WebSearchAdapter {
  return {
    id: "tavily",
    isConfigured: () => Boolean(apiKey),

    async search({ query, limit = 5, signal }): Promise<WebSearchResponse> {
      if (!apiKey) throw new Error("Tavily is not configured.");
      const response = await fetch(TAVILY_SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: Math.min(Math.max(limit, 1), 10),
          search_depth: "basic",
          include_answer: false,
        }),
        signal: signal ?? AbortSignal.timeout(OPERATOR_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`Tavily search failed (${response.status}).`);
      }
      const payload = (await response.json()) as { results?: TavilyResult[] };
      return {
        provider: "tavily",
        query,
        hits: (payload.results ?? [])
          .map(toHit)
          .filter((hit): hit is WebSearchHit => hit !== null),
      };
    },

    async fetchPage({ url, signal }): Promise<WebPage> {
      const response = await fetch(url, {
        headers: { "User-Agent": "LunaboxResearch/1.0" },
        signal: signal ?? AbortSignal.timeout(OPERATOR_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`Fetching the page failed (${response.status}).`);
      }
      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();
      const text = contentType.includes("html")
        ? htmlToPlainText(body)
        : body;
      const title = contentType.includes("html")
        ? body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()
        : undefined;
      return {
        url,
        ...(title ? { title } : {}),
        text: text.slice(0, MAX_PAGE_CHARS),
      };
    },
  };
}
