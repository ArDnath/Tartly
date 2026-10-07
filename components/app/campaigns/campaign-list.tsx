"use client";

import { Megaphone, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CampaignListItem = {
  id: string;
  name: string;
  status: string;
  replyPolicy: string;
  total: number;
  stats: Record<string, number>;
  createdAt: string;
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-secondary text-muted-foreground",
  sending: "bg-sky-500/10 text-sky-500",
  paused: "bg-amber-500/10 text-amber-500",
  done: "bg-emerald-500/10 text-emerald-500",
  cancelled: "bg-rose-500/10 text-rose-500",
  scheduled: "bg-indigo-500/10 text-indigo-500",
};

export function CampaignList({
  initial,
  enabled,
}: {
  initial: CampaignListItem[];
  enabled: boolean;
}) {
  const [campaigns, setCampaigns] = useState(initial);
  const [loading, setLoading] = useState(false);

  // Light polling so an active send's counts stay live.
  useEffect(() => {
    const active = campaigns.some((campaign) => campaign.status === "sending");
    if (!active) return;
    const id = setInterval(() => {
      setLoading(true);
      fetch("/api/v1/campaigns", { cache: "no-store" })
        .then((response) => response.json())
        .then((payload: { data?: { campaigns: CampaignListItem[] } }) => {
          if (payload.data?.campaigns) setCampaigns(payload.data.campaigns);
        })
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 10_000);
    return () => clearInterval(id);
  }, [campaigns]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {campaigns.length} {campaigns.length === 1 ? "campaign" : "campaigns"}
          {loading ? " · refreshing…" : ""}
        </p>
        {enabled ? (
          <Link href="/campaigns/new" className={cn(buttonVariants({ size: "sm" }))}>
            <Plus className="size-3.5" />
            New campaign
          </Link>
        ) : null}
      </div>

      {!enabled ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Campaigns are disabled in this environment.
        </p>
      ) : null}

      {campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <Megaphone className="size-7 text-muted-foreground/60" aria-hidden />
          <p className="text-sm font-medium text-foreground">No campaigns yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Import a spreadsheet, personalize it with your voice, and send a
            throttled, compliant batch.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {campaigns.map((campaign) => (
            <li key={campaign.id}>
              <Link
                href={`/campaigns/${campaign.id}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-accent/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">
                    {campaign.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {campaign.total} recipients · sent {campaign.stats.sent ?? 0} ·
                    replied {campaign.stats.replied ?? 0} · unsub{" "}
                    {campaign.stats.unsubscribed ?? 0}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                    STATUS_STYLES[campaign.status] ?? "bg-secondary text-muted-foreground",
                  )}
                >
                  {campaign.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
