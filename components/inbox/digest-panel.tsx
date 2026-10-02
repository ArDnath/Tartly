"use client";

import { ChevronDown, Loader2, Newspaper, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type {
  DigestGroup,
  DigestPayload,
} from "@/lib/inbox/digest-types";
import { cn } from "@/lib/utils";

const GROUP_META: Record<DigestGroup, { label: string; accent: string }> = {
  needs_you: { label: "Needs you", accent: "text-amber-500" },
  waiting: { label: "Waiting", accent: "text-sky-500" },
  handled: { label: "Handled", accent: "text-emerald-500" },
  noise: { label: "Noise", accent: "text-muted-foreground" },
};

const GROUP_ORDER: DigestGroup[] = ["needs_you", "waiting", "handled", "noise"];

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/**
 * The inbox digest (Phase 4). Server-rendered digest first; "Generate" is the
 * only action that spends a model call. Counts come from the same grouping as
 * the inbox, so they never disagree.
 */
export function DigestPanel({
  initial,
  enabled,
}: {
  initial: DigestPayload | null;
  enabled: boolean;
}) {
  const [digest, setDigest] = useState<DigestPayload | null>(initial);
  const [open, setOpen] = useState(Boolean(initial));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/inbox/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "daily" }),
      });
      const payload = (await response.json()) as {
        data?: { digest: DigestPayload };
        error?: { message?: string };
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message || "Couldn't generate a digest.");
      }
      setDigest(payload.data.digest);
      setOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't generate a digest.");
    } finally {
      setLoading(false);
    }
  };

  if (!enabled && !digest) return null;

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    lines: digest?.items.filter((item) => item.group === group) ?? [],
  })).filter((entry) => entry.lines.length > 0);

  return (
    <section className="border-b border-border bg-canvas/60">
      <div className="flex items-center gap-2 px-5 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          disabled={!digest}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
        >
          <Newspaper className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-foreground">
              {digest?.headline ?? "Inbox digest"}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {digest
                ? `${digest.threadCount} threads · ${formatWhen(digest.generatedAt)}${digest.source === "heuristic" ? " · basic" : ""}`
                : "Summarize what changed in your inbox."}
            </span>
          </span>
          {digest ? (
            <ChevronDown
              className={cn(
                "ml-auto size-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
              aria-hidden
            />
          ) : null}
        </button>

        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="size-3.5" aria-hidden />
          )}
          {digest ? "Refresh" : "Generate"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="px-5 pb-2 text-[12px] text-destructive">
          {error}
        </p>
      ) : null}

      {open && digest ? (
        <div className="flex flex-col gap-3 px-5 pb-4">
          {digest.summary ? (
            <p className="max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
              {digest.summary}
            </p>
          ) : null}

          {grouped.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              Nothing new in this period.
            </p>
          ) : (
            grouped.map(({ group, lines }) => (
              <div key={group} className="flex flex-col gap-1">
                <p
                  className={cn(
                    "text-[10px] font-medium uppercase tracking-wider",
                    GROUP_META[group].accent,
                  )}
                >
                  {GROUP_META[group].label} · {lines.length}
                </p>
                <ul className="flex flex-col">
                  {lines.slice(0, 6).map((line, index) => (
                    <li key={`${group}-${line.threadId ?? index}`}>
                      {line.threadId ? (
                        <Link
                          href={`/inbox/${line.threadId}`}
                          className="flex items-baseline gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-accent"
                        >
                          <span className="truncate text-[12px] font-medium text-foreground">
                            {line.title}
                          </span>
                          {line.snippet ? (
                            <span className="hidden min-w-0 flex-1 truncate text-[11px] text-muted-foreground sm:block">
                              {line.snippet}
                            </span>
                          ) : null}
                        </Link>
                      ) : (
                        <span className="px-1.5 py-1 text-[12px] text-foreground">
                          {line.title}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}
