"use client";

import {
  ArrowsClockwise,
  CircleNotch,
  Lightbulb,
} from "@phosphor-icons/react/ssr";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { ReportPayload } from "@/lib/activity/report-types";

/**
 * Weekly insights report (Phase 5). Server-rendered cached report first;
 * "Generate" is the only action that spends a model call.
 */
export function InsightsReport({
  initial,
  enabled,
}: {
  initial: ReportPayload | null;
  enabled: boolean;
}) {
  const [report, setReport] = useState<ReportPayload | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/activity/report", { method: "POST" });
      const payload = (await response.json()) as {
        data?: { report: ReportPayload };
        error?: { message?: string };
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message || "Couldn't generate the report.");
      }
      setReport(payload.data.report);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't generate the report.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Lightbulb weight="fill" className="size-4 text-muted-foreground" aria-hidden />
          <div>
            <h2 className="text-[13px] font-semibold text-foreground">
              Weekly insights
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {report
                ? `Last ${report.metrics.windowDays} days · ${report.source === "model" ? "AI analysis" : "from your data"}`
                : "A weekly read on your inbox."}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={generate}
          disabled={loading || !enabled}
        >
          {loading ? (
            <CircleNotch className="size-3.5 animate-spin" />
          ) : (
            <ArrowsClockwise className="size-3.5" />
          )}
          {report ? "Refresh" : "Generate"}
        </Button>
      </div>

      {error ? (
        <p className="text-[12px] text-destructive">{error}</p>
      ) : null}

      {report ? (
        <>
          <div>
            <p className="text-[14px] font-medium text-foreground">
              {report.headline}
            </p>
            {report.summary ? (
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                {report.summary}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Needs you" value={report.metrics.needsReply} />
            <Metric label="Waiting" value={report.metrics.waitingOnThem} />
            <Metric
              label="Noise"
              value={`${Math.round(report.metrics.noiseRatio * 100)}%`}
            />
            <Metric
              label="Avg response"
              value={
                report.metrics.avgResponseHours === null
                  ? "—"
                  : `${report.metrics.avgResponseHours}h`
              }
            />
          </div>

          {report.metrics.topSenders.length > 0 ? (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Top senders
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {report.metrics.topSenders.map((sender) => (
                  <li
                    key={sender.email}
                    className="flex items-center justify-between gap-2 text-[12px]"
                  >
                    <span className="truncate text-foreground">{sender.email}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {sender.messages}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {report.suggestions.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {report.suggestions.map((suggestion) => (
                <div
                  key={suggestion.title}
                  className="border border-border bg-muted/30 px-3 py-2"
                >
                  <p className="text-[12px] font-medium text-foreground">
                    {suggestion.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {suggestion.detail}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          {enabled
            ? "Generate a report to see response times, top senders, noise ratio and suggestions."
            : "Insights are disabled in this environment."}
        </p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-border px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-[15px] font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}
