"use client";

import { CoinsIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { asNumber, asRecord, asString } from "./shared";

/** The agent's self-reported AI usage — inspectable spend, not a black box. */
export function AiCostCard({ output }: { output: unknown }) {
  const data = asRecord(output);
  const calls = asNumber(data?.calls) ?? 0;
  const windowDays = asNumber(data?.windowDays) ?? 7;
  const costLabel = asString(data?.estimatedCostLabel) ?? "$0.00";
  const totalTokens = asNumber(data?.totalTokens) ?? 0;
  const byFeature = Array.isArray(data?.byFeature) ? data.byFeature : [];

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <CoinsIcon className="size-4 text-muted-foreground" aria-hidden />
          AI usage — last {windowDays} day{windowDays === 1 ? "" : "s"}
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            <strong className="text-foreground">{costLabel}</strong> estimated
            cost
          </span>
          <span>
            <strong className="text-foreground">{calls}</strong> calls
          </span>
          <span>
            <strong className="text-foreground">
              {totalTokens.toLocaleString()}
            </strong>{" "}
            tokens
          </span>
        </div>
        {byFeature.length > 0 ? (
          <ul className="flex flex-col gap-1 border-t border-border/60 pt-2">
            {byFeature.slice(0, 6).map((raw, index) => {
              const row = asRecord(raw) ?? {};
              const feature = asString(row.feature) ?? `feature-${index}`;
              return (
                <li
                  key={feature}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="truncate text-muted-foreground">{feature}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {asNumber(row.calls) ?? 0} ·{" "}
                    {asString(row.estimatedCostLabel) ?? "$0.00"}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
