/**
 * Web research contract.
 *
 * The agent never talks to a search API directly. A `WebSearchAdapter` is the
 * one place a provider SDK/HTTP shape lives; swapping Tavily for Brave, SerpAPI
 * or a self-hosted search means adding one adapter and changing
 * `SEARCH_PROVIDER`. Every result is untrusted third-party content.
 */

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
  /** ISO timestamp when the provider reports one. */
  publishedAt?: string;
  /** Provider relevance in [0,1], when reported. Never invented. */
  score?: number;
}

export interface WebSearchResponse {
  provider: string;
  query: string;
  hits: WebSearchHit[];
}

export interface WebPage {
  url: string;
  title?: string;
  text: string;
}

export interface WebSearchAdapter {
  /** Stable id, e.g. "tavily". */
  readonly id: string;
  isConfigured(): boolean;
  search(input: {
    query: string;
    limit?: number;
    signal?: AbortSignal;
  }): Promise<WebSearchResponse>;
  fetchPage?(input: { url: string; signal?: AbortSignal }): Promise<WebPage>;
}

/** Thrown when a research tool is used but no provider is configured. */
export class ResearchUnavailableError extends Error {
  constructor() {
    super(
      "Web research is not configured. Set SEARCH_API_KEY to enable it.",
    );
    this.name = "ResearchUnavailableError";
  }
}
