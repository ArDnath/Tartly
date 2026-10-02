import type { ReactNode } from "react";

import { formatSignedPercent } from "@/lib/activity/format";
import { cn } from "@/lib/utils";

/**
 * Presentational primitives for the Activity board.
 *
 * The board is a single grid of flush boxes: every `Cell` owns its own bottom
 * and right hairline, so the layout reads as line-delimited blocks rather than
 * a masonry of floating cards. Charts are painted by dither-kit (see
 * `charts-client.tsx`); this file only holds the static shells and meters.
 */

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * One bento tile. Glass surface on the canvas: a soft card fill, a hairline
 * border, a gentle lift shadow and a top highlight, so the four tiles read as
 * floating boxes with breathing room rather than line-delimited blocks. The tile
 * is a flex column so its chart body can claim the leftover height (`flex-1`)
 * and the whole board fits one viewport without scrolling.
 */
export function Cell({
  label,
  action,
  children,
  className,
}: {
  label?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "group relative flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden rounded-2xl border border-border/70 bg-card/40 p-3.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_18px_40px_-24px_rgba(0,0,0,0.8)] backdrop-blur-sm transition-colors duration-200 hover:border-border sm:p-4",
        className,
      )}
    >
      {label || action ? (
        <header className="flex min-h-4 items-center justify-between gap-3">
          {label ? (
            <h2 className="flex items-center gap-2 truncate text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <span
                className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
                aria-hidden
              />
              {label}
            </h2>
          ) : (
            <span />
          )}
          {action}
        </header>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

/** A small signed-change chip: green up, red down, muted flat. */
export function DeltaPill({ value }: { value: number }) {
  const up = value > 0.005;
  const down = value < -0.005;
  return (
    <span
      title="Compared with the previous window"
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums ring-1",
        up
          ? "text-emerald-400 ring-emerald-400/20"
          : down
            ? "text-red-400 ring-red-400/20"
            : "text-muted-foreground ring-border",
      )}
    >
      {formatSignedPercent(value)}
    </span>
  );
}

/** A neutral note where a trend delta is not meaningful (e.g. a rate, a budget). */
export function InfoPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warn";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums ring-1",
        tone === "warn"
          ? "text-warning ring-warning/25"
          : "text-muted-foreground ring-border",
      )}
    >
      {children}
    </span>
  );
}

/** A thin horizontal meter; the workhorse for ratios inside the board. */
export function Meter({
  value,
  tone = "default",
}: {
  value: number;
  /** Threshold tone: neutral, amber, or red. */
  tone?: "default" | "warn" | "danger";
}) {
  const clamped = clamp01(value);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.07]">
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          tone === "danger"
            ? "bg-destructive"
            : tone === "warn"
              ? "bg-warning"
              : "bg-foreground/75",
        )}
        style={{ width: `${clamped > 0 ? Math.max(3, clamped * 100) : 0}%` }}
      />
    </div>
  );
}

/** A labelled figure, used for the compact signals column. */
export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-[19px] font-semibold leading-none tabular-nums text-foreground">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 truncate text-[10.5px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A quiet, teaching empty state for a panel that has no data yet. */
export function EmptyPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[160px] flex-col items-start justify-center gap-1 rounded-lg border border-dashed border-border px-4 py-6">
      <p className="text-[12.5px] font-medium text-foreground">{title}</p>
      <p className="max-w-[52ch] text-[12px] leading-relaxed text-muted-foreground">
        {children}
      </p>
    </div>
  );
}
