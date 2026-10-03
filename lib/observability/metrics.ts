/**
 * Minimal in-process RED/USE metrics registry (Phase D5).
 *
 * Serverless instances are ephemeral, but the SKILL §13/§16 contract asks for
 * *exported* RED metrics. This registry records request counters and latency
 * histograms in memory and renders them in the Prometheus text exposition
 * format from `/api/health/metrics`, so a self-hosted scrape (or a sidecar) can
 * read p50/p95/p99 without an external SDK.
 *
 * Label cardinality is bounded by the caller: `withUser` passes the matched
 * contract *path template* (`/api/v1/runs/{id}`), never the raw path with ids.
 *
 * Pure and dependency-free, so the renderer is unit-testable.
 */

export type MetricLabels = Record<string, string | number>;

type Histogram = {
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
};

/** Latency buckets in seconds, tuned for API/DB work. */
export const DEFAULT_LATENCY_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

const counters = new Map<string, { name: string; labels: MetricLabels; value: number }>();
const histograms = new Map<
  string,
  { name: string; labels: MetricLabels; histogram: Histogram }
>();
const gauges = new Map<string, { name: string; labels: MetricLabels; value: number }>();

function seriesKey(name: string, labels: MetricLabels): string {
  const entries = Object.entries(labels)
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${name}|${entries.map(([k, v]) => `${k}=${v}`).join(",")}`;
}

export function incrementCounter(
  name: string,
  labels: MetricLabels = {},
  value = 1,
): void {
  const key = seriesKey(name, labels);
  const existing = counters.get(key);
  counters.set(key, {
    name,
    labels,
    value: (existing?.value ?? 0) + value,
  });
}

export function setGauge(
  name: string,
  value: number,
  labels: MetricLabels = {},
): void {
  gauges.set(seriesKey(name, labels), { name, labels, value });
}

export function observeHistogram(
  name: string,
  value: number,
  labels: MetricLabels = {},
  buckets: number[] = DEFAULT_LATENCY_BUCKETS,
): void {
  const key = seriesKey(name, labels);
  let entry = histograms.get(key);
  if (!entry) {
    entry = {
      name,
      labels,
      histogram: { buckets, counts: buckets.map(() => 0), sum: 0, count: 0 },
    };
    histograms.set(key, entry);
  }
  const histogram = entry.histogram;
  for (let index = 0; index < histogram.buckets.length; index += 1) {
    if (value <= histogram.buckets[index]!) histogram.counts[index]! += 1;
  }
  histogram.sum += value;
  histogram.count += 1;
}

/**
 * Records one HTTP request: the RED counter plus a latency observation.
 * `route` must be a bounded template, never a raw path.
 */
export function recordHttpRequest(input: {
  method: string;
  route: string;
  status: number;
  durationMs: number;
}): void {
  const labels = {
    method: input.method,
    route: input.route,
    status: String(input.status),
  };
  incrementCounter("http_requests_total", labels);
  observeHistogram("http_request_duration_seconds", input.durationMs / 1000, {
    method: input.method,
    route: input.route,
  });
}

/** Prometheus text exposition of every series plus process USE gauges. */
export function renderPrometheus(): string {
  const lines: string[] = [];

  for (const { name, labels, value } of [...counters.values()].sort(bySeries)) {
    lines.push(`${sanitizeName(name)}${renderLabels(labels)} ${value}`);
  }

  for (const { name, labels, histogram } of [...histograms.values()].sort(
    bySeries,
  )) {
    const metric = sanitizeName(name);
    for (let index = 0; index < histogram.buckets.length; index += 1) {
      lines.push(
        `${metric}_bucket${renderLabels({
          ...labels,
          le: String(histogram.buckets[index]),
        })} ${histogram.counts[index]}`,
      );
    }
    lines.push(
      `${metric}_bucket${renderLabels({ ...labels, le: "+Inf" })} ${histogram.count}`,
    );
    lines.push(`${metric}_sum${renderLabels(labels)} ${histogram.sum}`);
    lines.push(`${metric}_count${renderLabels(labels)} ${histogram.count}`);
  }

  // Process USE gauges: cheap, always available, no backing service.
  setGauge("process_uptime_seconds", process.uptime());
  setGauge("nodejs_heap_used_bytes", process.memoryUsage().heapUsed);
  setGauge("nodejs_rss_bytes", process.memoryUsage().rss);
  for (const { name, labels, value } of [...gauges.values()].sort(bySeries)) {
    lines.push(`${sanitizeName(name)}${renderLabels(labels)} ${value}`);
  }

  return `${lines.join("\n")}\n`;
}

function bySeries(
  a: { name: string; labels: MetricLabels },
  b: { name: string; labels: MetricLabels },
): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return seriesKey(a.name, a.labels) < seriesKey(b.name, b.labels) ? -1 : 1;
}

function renderLabels(labels: MetricLabels): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  const body = entries
    .map(([key, value]) => `${sanitizeName(key)}="${escapeLabel(String(value))}"`)
    .join(",");
  return `{${body}}`;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/** Test-only reset so suites do not leak series between cases. */
export function resetMetricsForTests(): void {
  counters.clear();
  histograms.clear();
  gauges.clear();
}
