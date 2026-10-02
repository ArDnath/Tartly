"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Thread summary panel (Phase 2, C8).
 *
 * A cached summary (a free `GET`) is shown when one exists; otherwise the user
 * clicks "Summarize" to generate one. Nothing is computed on page load, so
 * opening a thread never spends tokens.
 */

type Summary = {
  summary: string;
  decisions: string[];
  actionItems: string[];
  openQuestions: string[];
  messageCount: number;
  source: "model" | "heuristic";
};

export function ThreadSummary({
  threadId,
  canSummarize,
}: {
  threadId: string;
  canSummarize: boolean;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/v1/inbox/${threadId}/summary`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          data?: { summary: Summary | null; enabled: boolean };
        };
        if (cancelled) return;
        setSummary(payload.data?.summary ?? null);
        setEnabled(payload.data?.enabled ?? true);
      } catch {
        // A cache read failing is not worth surfacing.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const generate = async () => {
    setGenerating(true);
    try {
      const response = await fetch(`/api/v1/inbox/${threadId}/summary`, {
        method: "POST",
      });
      if (response.ok) {
        const payload = (await response.json()) as {
          data?: { summary: Summary };
        };
        if (payload.data?.summary) {
          setSummary(payload.data.summary);
          setOpen(true);
        }
      }
    } finally {
      setGenerating(false);
    }
  };

  if (!enabled || (!canSummarize && !summary)) return null;

  if (!summary) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={generate}
        disabled={generating}
        className="gap-1.5"
      >
        {generating ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Sparkles className="size-3.5" />
        )}
        Summarize thread
      </Button>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card/60 px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Sparkles className="size-3" /> Summary
          {summary.source === "heuristic" ? " (offline)" : ""}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open ? (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-[13px] leading-relaxed text-foreground/90">
            {summary.summary}
          </p>
          <SummaryList title="Decisions" items={summary.decisions} />
          <SummaryList title="Action items" items={summary.actionItems} />
          <SummaryList title="Open questions" items={summary.openQuestions} />
        </div>
      ) : null}
    </section>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <ul className="mt-0.5 list-disc pl-4 text-[12.5px] leading-relaxed text-foreground/85">
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
