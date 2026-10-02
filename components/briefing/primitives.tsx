"use client";

import type { ReactNode } from "react";

/** Shared bits for the briefing cards so they stay visually consistent. */

export function KindBadge({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded border border-border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

export function DraftPreview({ body }: { body?: string }) {
  if (!body) return null;
  return (
    <p className="max-h-40 overflow-hidden whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[13px] leading-relaxed text-foreground/90">
      {body}
    </p>
  );
}

export function MetaLine({ children }: { children: ReactNode }) {
  return <p className="truncate text-[11px] text-muted-foreground">{children}</p>;
}
