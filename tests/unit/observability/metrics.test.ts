import { afterEach, describe, expect, it } from "vitest";

import {
  incrementCounter,
  observeHistogram,
  recordHttpRequest,
  renderPrometheus,
  resetMetricsForTests,
  setGauge,
} from "@/lib/observability/metrics";

describe("metrics registry", () => {
  afterEach(() => resetMetricsForTests());

  it("accumulates counters and renders Prometheus text", () => {
    incrementCounter("http_requests_total", { method: "GET", status: "200" });
    incrementCounter("http_requests_total", { method: "GET", status: "200" });
    incrementCounter("http_requests_total", { method: "GET", status: "500" });

    const output = renderPrometheus();
    expect(output).toContain(
      'http_requests_total{method="GET",status="200"} 2',
    );
    expect(output).toContain(
      'http_requests_total{method="GET",status="500"} 1',
    );
  });

  it("renders histogram buckets, sum and count", () => {
    observeHistogram("op_seconds", 0.02, { route: "/a" });
    observeHistogram("op_seconds", 3, { route: "/a" });

    const output = renderPrometheus();
    // 0.02 falls in the first bucket >= 0.025; 3 falls in the first >= 5.
    expect(output).toContain('op_seconds_bucket{route="/a",le="0.01"} 0');
    expect(output).toContain('op_seconds_bucket{route="/a",le="0.025"} 1');
    expect(output).toContain('op_seconds_bucket{route="/a",le="5"} 2');
    expect(output).toContain('op_seconds_bucket{route="/a",le="+Inf"} 2');
    expect(output).toContain('op_seconds_count{route="/a"} 2');
    expect(output).toContain('op_seconds_sum{route="/a"} 3.02');
  });

  it("records an HTTP request as a counter plus a latency observation", () => {
    recordHttpRequest({
      method: "POST",
      route: "/api/v1/runs/{id}",
      status: 201,
      durationMs: 42,
    });
    const output = renderPrometheus();
    expect(output).toContain(
      'http_requests_total{method="POST",route="/api/v1/runs/{id}",status="201"} 1',
    );
    expect(output).toContain(
      'http_request_duration_seconds_count{method="POST",route="/api/v1/runs/{id}"} 1',
    );
  });

  it("overwrites gauges with the latest value", () => {
    setGauge("queue_depth", 3);
    setGauge("queue_depth", 7);
    const output = renderPrometheus();
    expect(output).toContain("queue_depth 7");
    expect(output).not.toContain("queue_depth 3");
  });

  it("includes process USE gauges", () => {
    const output = renderPrometheus();
    expect(output).toMatch(/process_uptime_seconds \d/);
    expect(output).toMatch(/nodejs_heap_used_bytes \d/);
    expect(output).toMatch(/nodejs_rss_bytes \d/);
  });

  it("escapes label values and sanitizes names", () => {
    incrementCounter("odd name", { note: 'a"b\\c\nd' });
    const output = renderPrometheus();
    expect(output).toContain("odd_name");
    expect(output).toContain('note="a\\"b\\\\c\\nd"');
  });
});
