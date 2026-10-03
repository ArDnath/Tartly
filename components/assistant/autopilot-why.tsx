"use client";

import { HelpCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Decision = {
  decision: string;
  reason: string;
  reasonLabel: string;
  category: string | null;
  confidence: string | null;
  checks: Record<string, boolean> | null;
  createdAt: string;
};

/**
 * The thread "Why?" popover: the last autopilot decision for this thread, in
 * plain English. Content-free by construction — it shows the reason code's
 * label, the category, the confidence and the boolean checks, never the body.
 */
export function AutopilotWhy({
  threadId,
  className,
}: {
  threadId: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);

  const load = () => {
    if (loaded) return;
    fetch(`/api/v1/autopilot/decisions?threadId=${encodeURIComponent(threadId)}`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { data?: { items?: Decision[] } } | null) => {
        setDecision(payload?.data?.items?.[0] ?? null);
      })
      .catch(() => setDecision(null))
      .finally(() => setLoaded(true));
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
      }}
    >
      <PopoverTrigger
        aria-label="Why did autopilot do this?"
        className={cn(
          "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground",
          className,
        )}
      >
        <HelpCircle className="size-3" aria-hidden />
        Why?
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-2 text-[12px]">
        {!loaded ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : !decision ? (
          <p className="text-muted-foreground">
            No autopilot decision has been recorded for this thread yet. It stays
            a draft until 24/7 Autopilot sends or holds a reply.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <Badge variant={decision.decision === "send" ? "default" : "secondary"}>
                {decision.decision === "send" ? "Sent automatically" : "Held"}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                {new Date(decision.createdAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <p className="text-foreground">{decision.reasonLabel}</p>
            <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
              {decision.category ? (
                <span className="rounded border border-border px-1.5 py-px">
                  {decision.category.replace(/_/g, " ")}
                </span>
              ) : null}
              {decision.confidence ? (
                <span className="rounded border border-border px-1.5 py-px">
                  {decision.confidence.toLowerCase()} confidence
                </span>
              ) : null}
            </div>
            <Link
              href="/settings/autopilot"
              className="mt-1 inline-flex text-[11px] font-medium text-foreground underline-offset-4 hover:underline"
            >
              Review 24/7 Autopilot settings
            </Link>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
