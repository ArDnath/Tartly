import "server-only";

import { env } from "@/lib/env";

import { createTavilyAdapter } from "./tavily";
import { ResearchUnavailableError, type WebSearchAdapter } from "./types";

/**
 * Resolve the configured web-search adapter.
 *
 * Only Tavily ships today. Adding Brave/SerpAPI/self-hosted is a new adapter
 * plus a `SEARCH_PROVIDER` value — no tool, service or route changes.
 */
export function getWebSearchAdapter(): WebSearchAdapter {
  switch ((env.SEARCH_PROVIDER ?? "tavily").toLowerCase()) {
    case "tavily":
      return createTavilyAdapter(env.SEARCH_API_KEY);
    default:
      return unconfiguredAdapter(env.SEARCH_PROVIDER ?? "unknown");
  }
}

export function isResearchConfigured(): boolean {
  return getWebSearchAdapter().isConfigured();
}

function unconfiguredAdapter(id: string): WebSearchAdapter {
  return {
    id,
    isConfigured: () => false,
    async search() {
      throw new ResearchUnavailableError();
    },
    async fetchPage() {
      throw new ResearchUnavailableError();
    },
  };
}

export { htmlToPlainText } from "./tavily";
export type {
  WebPage,
  WebSearchAdapter,
  WebSearchHit,
  WebSearchResponse,
} from "./types";
