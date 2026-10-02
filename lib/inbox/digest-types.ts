/**
 * Client-safe shapes for the inbox digest.
 *
 * Kept out of `lib/ai/features/digest.ts` (which is `server-only`) and out of
 * `lib/db/schema.ts` so presentational components can import the types without
 * pulling the database or provider layer into the browser bundle.
 */

export type DigestGroup = "needs_you" | "waiting" | "handled" | "noise";

export type DigestKind = "daily" | "weekly";

export type DigestLine = {
  threadId: string | null;
  group: DigestGroup;
  title: string;
  snippet: string | null;
  reason: string | null;
  priority: number;
};

export type DigestPayload = {
  id: string;
  kind: DigestKind;
  status: string;
  periodStart: string;
  periodEnd: string;
  headline: string | null;
  summary: string | null;
  source: "model" | "heuristic";
  threadCount: number;
  noiseCount: number;
  generatedAt: string;
  items: DigestLine[];
};
