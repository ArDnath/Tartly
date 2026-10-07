import type { CSSProperties } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Content-area placeholder shown while a server-rendered route resolves.
 *
 * Every app route renders inside its own `layout.tsx`, which owns the shell
 * (sidebar, panels). The matching `loading.tsx` drops this into the layout's
 * content slot, so the rail and header stay put and only the body shimmers —
 * navigation reads as instant instead of leaving the previous screen frozen.
 *
 * The blocks are deliberately generic (a header plus rows) and sized to the
 * common list/board rhythm, so the swap to real content barely shifts.
 */

function Bar({
  className,
  delay = 0,
  style,
}: {
  className?: string;
  delay?: number;
  style?: CSSProperties;
}) {
  return (
    <Skeleton
      className={cn("motion-reduce:animate-none", className)}
      style={{ animationDelay: delay ? `${delay}ms` : undefined, ...style }}
    />
  );
}

/** Matches the shared `PageHeader`: a title line, a subtitle line, an action. */
function HeaderSkeleton() {
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border px-5 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Bar className="h-3.5 w-28 rounded-md" />
        <Bar className="h-2.5 w-52 rounded-md" delay={60} />
      </div>
      <Bar className="h-8 w-24 rounded-lg" delay={120} />
    </header>
  );
}

export type RouteLoadingVariant = "list" | "board" | "chat";

export function RouteLoading({
  variant = "list",
  rows = 6,
}: {
  variant?: RouteLoadingVariant;
  rows?: number;
}) {
  return (
    <div role="status" aria-live="polite" className="flex h-full min-h-0 flex-col">
      <span className="sr-only">Loading…</span>
      <HeaderSkeleton />

      <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
        {variant === "list" ? (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
            {Array.from({ length: rows }).map((_, i) => (
              <Bar key={i} className="h-14 w-full rounded-lg" delay={i * 60} />
            ))}
          </div>
        ) : null}

        {variant === "board" ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: rows }).map((_, i) => (
              <Bar key={i} className="h-24 w-full rounded-xl" delay={i * 60} />
            ))}
          </div>
        ) : null}

        {variant === "chat" ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <Bar className="h-4 w-2/3 rounded-md" />
            <Bar className="ml-auto h-10 w-1/2 rounded-xl" delay={80} />
            <Bar className="h-16 w-3/4 rounded-xl" delay={160} />
            <Bar className="ml-auto h-8 w-2/5 rounded-xl" delay={240} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
