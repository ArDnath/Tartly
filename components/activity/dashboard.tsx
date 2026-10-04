import type { Icon } from "@phosphor-icons/react";
import {
  ArrowUpRight,
  CalendarCheck,
  FileText,
  Info,
  Moon,
  ShieldCheck,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import type { ReactNode } from "react";

import { BudgetPanel, HighlightsPanel, OverviewPanel } from "@/components/activity/charts-client";
import { Cell, EmptyPanel } from "@/components/activity/charts";
import { formatRelativeTime } from "@/lib/activity/format";
import type {
  ActivityAutopilot,
  ActivityDashboard,
  ActivityFeedItem,
} from "@/lib/activity/types";
import { cn } from "@/lib/utils";

/**
 * The Activity board — a single glanceable bento. Four glass tiles float on the
 * canvas with even gutters and no page scroll: the two tall, chart-led tiles
 * (Overview, Highlights) span the wide columns while Signals and the Activity
 * log take the narrow ones.
 *
 *   Overview   · model turns, tokens and success over time
 *   Signals    · today's AI budget, broken down by what it was spent on
 *   Activity   · the operator's outcomes (drafts, meetings, approvals)
 *   Highlights · top senders, inbox mix and rhythm (the board's closing tile)
 *
 * The log deliberately omits raw runs/turns — those live in the Overview and
 * `/runs`; the log is for work that actually changed something. Highlights
 * keeps to the positive, personal signals — who writes, what arrives, when the
 * operator works and what has been earned — never error or failure counts.
 */

const FEED_ICONS: Record<ActivityFeedItem["kind"], Icon> = {
  draft: FileText,
  meeting: CalendarCheck,
  action: ShieldCheck,
};

function statusDot(status: string): string {
  const value = status.toLowerCase();
  if (value === "failed" || value === "error" || value === "expired") {
    return "bg-destructive";
  }
  if (
    value === "running" ||
    value === "pending" ||
    value === "executing" ||
    value === "proposed"
  ) {
    return "bg-warning";
  }
  if (
    value === "limit_reached" ||
    value === "aborted" ||
    value === "cancelled" ||
    value === "discarded"
  ) {
    return "bg-muted-foreground/50";
  }
  return "bg-foreground/70";
}

/** The small outward link used in a cell header. */
function CellAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-1 px-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground"
    >
      {children}
      <ArrowUpRight className="size-3" aria-hidden />
    </Link>
  );
}

function FeedRow({ item }: { item: ActivityFeedItem }) {
  const Icon = FEED_ICONS[item.kind];
  const body = (
    <>
      <span className="relative grid size-7 shrink-0 place-items-center bg-foreground/[0.06] text-foreground">
        <Icon className="size-3.5" aria-hidden />
        <span
          className={cn(
            "absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-background",
            statusDot(item.status),
          )}
          aria-hidden
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium text-foreground">
          {item.title}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {item.detail}
        </span>
      </span>
      <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
        {formatRelativeTime(item.at)}
      </span>
    </>
  );

  return (
    <li className="border-b border-border/60 last:border-0">
      {item.href ? (
        <Link
          href={item.href}
          className="flex items-center gap-3 px-1.5 py-2 transition-colors hover:bg-foreground/[0.03] hover:text-foreground"
        >
          {body}
        </Link>
      ) : (
        <div className="flex items-center gap-3 px-1.5 py-2">{body}</div>
      )}
    </li>
  );
}

export function ActivityDashboardView({
  data,
}: {
  data: ActivityDashboard;
}) {
  const {
    totals,
    deltas,
    daily,
    stats,
    budget,
    feed,
    senders,
    emailMix,
    peak,
    busiestDay,
    streak,
    autopilot,
  } = data;

  if (!data.hasData) {
    return (
      <div className="flex h-full items-start justify-center p-4">
        <div className="flex max-w-[62ch] items-start gap-3 border border-border/70 bg-card/60 p-5">
          <span className="grid size-8 shrink-0 place-items-center bg-foreground/[0.06] text-foreground">
            <Info className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-foreground">No activity yet</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Numbers appear here the moment the operator runs — triaging mail,
              drafting replies, and booking meetings.
            </p>
            <Link
              href="/assistant"
              className="mt-2.5 inline-flex items-center gap-1 text-[12px] font-medium text-foreground underline-offset-4 hover:underline"
            >
              Open the assistant
              <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 sm:gap-4 sm:p-4">
      <header className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-baseline gap-2">
          <h1 className="text-[13px] font-semibold tracking-tight text-foreground">
            Activity
          </h1>
          <span className="text-[11px] text-muted-foreground">
            last {data.windowDays} days
          </span>
        </div>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          updated {formatRelativeTime(data.generatedAt)}
        </span>
      </header>

      <AutopilotStrip autopilot={autopilot} />

      {/* Bento: two chart-led tiles span 8 of 12 columns; Signals and the log
          take the remaining 4. On xl the two rows split the viewport evenly so
          the board never scrolls; below xl the tiles stack and the grid area
          scrolls instead of the page. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto xl:grid-cols-12 xl:grid-rows-2 xl:overflow-hidden">
        <Cell
          label="Overview"
          action={<CellAction href="/runs">Runs</CellAction>}
          className="min-h-[360px] xl:col-span-8 xl:min-h-0"
        >
          <OverviewPanel
            stats={stats}
            totals={totals}
            deltas={deltas}
            daily={daily}
            windowDays={data.windowDays}
          />
        </Cell>

        <Cell
          label="Signals"
          className="min-h-[360px] xl:col-span-4 xl:min-h-0"
        >
          <BudgetPanel budget={budget} />
        </Cell>

        <Cell
          label="Activity log"
          action={<CellAction href="/inbox">Inbox</CellAction>}
          className="min-h-[320px] xl:col-span-4 xl:min-h-0"
        >
          {feed.length === 0 ? (
            <EmptyPanel title="No outcomes yet">
              The log fills as the operator works — every sent reply, booked
              meeting and pending approval lands here. Model turns stay in
              Overview.
            </EmptyPanel>
          ) : (
            <ul className="scrollbar-none -mr-1 flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
              {feed.map((item) => (
                <FeedRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </Cell>

        <Cell
          label="Highlights"
          className="min-h-[420px] xl:col-span-8 xl:min-h-0"
        >
          <HighlightsPanel
            senders={senders}
            emailMix={emailMix}
            daily={daily}
            peak={peak}
            busiestDay={busiestDay}
            streak={streak}
          />
        </Cell>
      </div>
    </div>
  );
}

function AutopilotStrip({ autopilot }: { autopilot: ActivityAutopilot }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border border-border/70 bg-card/60 px-4 py-2.5 text-[12px]">
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <Moon className="size-3.5 text-muted-foreground" aria-hidden />
        24/7 Autopilot
        <span
          className={cn(
            "border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide",
            autopilot.enabled
              ? "border-transparent bg-foreground text-background"
              : "border-border text-muted-foreground",
          )}
        >
          {autopilot.enabled ? autopilot.windowLabel : "Off"}
        </span>
      </span>

      <span className="text-muted-foreground">
        <strong className="font-medium text-foreground">{autopilot.sendsToday}</strong>{" "}
        sent today
      </span>
      <span className="text-muted-foreground">
        <strong className="font-medium text-foreground">{autopilot.sendsWindow}</strong>{" "}
        in 7 days
      </span>
      <span className="text-muted-foreground">
        <strong className="font-medium text-foreground">{autopilot.held}</strong> held
      </span>
      {autopilot.capHits > 0 ? (
        <span className="text-amber-600 dark:text-amber-400">
          {autopilot.capHits} cap {autopilot.capHits === 1 ? "hit" : "hits"}
        </span>
      ) : null}
      {autopilot.watchUnhealthy > 0 ? (
        <span className="text-amber-600 dark:text-amber-400">
          {autopilot.watchUnhealthy} push{" "}
          {autopilot.watchUnhealthy === 1 ? "watch" : "watches"} need attention
        </span>
      ) : null}
      {autopilot.deadJobs > 0 ? (
        <span className="text-destructive">
          {autopilot.deadJobs} dead {autopilot.deadJobs === 1 ? "job" : "jobs"}
        </span>
      ) : null}

      {autopilot.decisions.length > 0 ? (
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {autopilot.decisions.map((reason) => (
            <span
              key={reason.reason}
              title={reason.reason}
              className="border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              {reason.label} · {reason.count}
            </span>
          ))}
        </span>
      ) : (
        <Link
          href="/settings/autopilot"
          className="ml-auto text-[11px] font-medium text-foreground underline-offset-4 hover:underline"
        >
          Set up Autopilot
        </Link>
      )}
    </div>
  );
}
