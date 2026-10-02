/**
 * Client-safe shape of the weekly inbox insights report.
 *
 * Kept out of `lib/ai/features/report.ts` (which is `server-only`) so the
 * activity board can render it without importing the database layer.
 */

export type ReportSuggestion = {
  title: string;
  detail: string;
};

export type ReportMetrics = {
  windowDays: number;
  threadsProcessed: number;
  needsReply: number;
  waitingOnThem: number;
  handled: number;
  noise: number;
  noiseRatio: number;
  draftsCreated: number;
  repliesSent: number;
  meetingsBooked: number;
  followupsActive: number;
  rulesApplied: number;
  /** Average hours between an inbound message and the next reply. */
  avgResponseHours: number | null;
  topSenders: Array<{ email: string; messages: number }>;
};

export type ReportPayload = {
  id: string;
  periodStart: string;
  periodEnd: string;
  headline: string | null;
  summary: string | null;
  suggestions: ReportSuggestion[];
  source: "model" | "heuristic";
  metrics: ReportMetrics;
  generatedAt: string;
  /** True when served from the weekly cache rather than freshly generated. */
  cached: boolean;
};
