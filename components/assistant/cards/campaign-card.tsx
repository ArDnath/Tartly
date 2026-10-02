"use client";

import { MegaphoneIcon, SendIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { asBoolean, asNumber, asRecord, asString } from "./shared";

const COUNT_ORDER = [
  "sent",
  "pending",
  "replied",
  "failed",
  "bounced",
  "unsubscribed",
  "skipped",
] as const;

function CountsLine({ counts }: { counts: Record<string, unknown> | null }) {
  if (!counts) return null;
  const parts = COUNT_ORDER.filter((key) => (asNumber(counts[key]) ?? 0) > 0).map(
    (key) => `${asNumber(counts[key]) ?? 0} ${key}`,
  );
  if (parts.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">{parts.join(" · ")}</p>
  );
}

/** The draft campaign created by `start_campaign`. Nothing is sent here. */
export function CampaignCard({ output }: { output: unknown }) {
  const data = asRecord(output);
  if (!data || asBoolean(data.created) === false) {
    return (
      <Card size="sm">
        <CardContent className="text-sm text-muted-foreground">
          {asString(data?.notice) ?? "No campaign created."}
        </CardContent>
      </Card>
    );
  }

  const summary = asRecord(data.summary);
  const imported = asNumber(summary?.imported);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <MegaphoneIcon className="size-4 text-muted-foreground" aria-hidden />
          Draft campaign ready
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-1.5 text-sm text-muted-foreground">
        {imported !== undefined ? (
          <p>
            <strong className="text-foreground">{imported}</strong> recipient
            {imported === 1 ? "" : "s"} imported.
          </p>
        ) : null}
        <p className="text-xs">
          {asString(data.notice) ??
            "Nothing has been sent. Open Campaigns to preview and start it."}
        </p>
      </CardContent>
    </Card>
  );
}

/** Progress of one campaign (or a list) from `get_campaign_status`. */
export function CampaignStatusCard({ output }: { output: unknown }) {
  const data = asRecord(output);

  if (!data || asBoolean(data.found) === false) {
    return (
      <Card size="sm">
        <CardContent className="text-sm text-muted-foreground">
          {asString(data?.notice) ?? "No campaign found."}
        </CardContent>
      </Card>
    );
  }

  // Single-campaign shape.
  if (data.found === true) {
    const name = asString(data.name) ?? "Campaign";
    const status = asString(data.status) ?? "unknown";
    const total = asNumber(data.total) ?? 0;
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <SendIcon className="size-4 text-muted-foreground" aria-hidden />
            {name} — {status}
          </CardTitle>
        </CardHeader>
        <CardContent className="gap-1.5 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">{total}</strong> recipient
            {total === 1 ? "" : "s"}
          </p>
          <CountsLine counts={asRecord(data.counts)} />
        </CardContent>
      </Card>
    );
  }

  // List shape.
  const campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
  if (campaigns.length === 0) {
    return (
      <Card size="sm">
        <CardContent className="text-sm text-muted-foreground">
          No campaigns yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <MegaphoneIcon className="size-4 text-muted-foreground" aria-hidden />
          Campaigns — {asNumber(data.count) ?? campaigns.length}
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-2">
        <ul className="flex flex-col gap-1.5">
          {campaigns.slice(0, 8).map((raw, index) => {
            const campaign = asRecord(raw) ?? {};
            return (
              <li key={asString(campaign.id) ?? index} className="flex flex-col gap-0.5">
                <span className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-foreground">
                    {asString(campaign.name) ?? `campaign-${index}`}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {asString(campaign.status) ?? "unknown"} ·{" "}
                    {asNumber(campaign.total) ?? 0}
                  </span>
                </span>
                <CountsLine counts={asRecord(campaign.counts)} />
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
