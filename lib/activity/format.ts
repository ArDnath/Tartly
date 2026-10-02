/**
 * Pure display helpers for the Activity board. Shared by the server-side
 * aggregation and the presentational components so a label can never drift
 * between the two.
 */

export const HEAT_BUCKETS = 8;
export const HEAT_BUCKET_HOURS = 24 / HEAT_BUCKETS;

/** "3 PM–6 PM" for bucket 5, wrapping cleanly at midnight. */
export function heatWindowLabel(bucket: number): string {
  const start = bucket * HEAT_BUCKET_HOURS;
  const end = (start + HEAT_BUCKET_HOURS) % 24;
  const hour = (value: number) => `${((value + 11) % 12) + 1} ${value < 12 ? "AM" : "PM"}`;
  return `${hour(start)}–${hour(end)}`;
}

/** 1_234_567 → "1.2M", 384_000 → "384K", 950 → "950". */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}K`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return "—";
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatSignedPercent(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value * 100).toFixed(0)}%`;
}

/** Coarse "how long ago", good enough for a dense feed. */
export function formatRelativeTime(iso: string, now = new Date()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}
