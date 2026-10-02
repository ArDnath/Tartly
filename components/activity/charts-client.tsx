"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { DeltaPill, EmptyPanel, InfoPill } from "@/components/activity/charts";
import {
  BlockLegend,
  Pie,
  PieChart,
  Tooltip,
  type ChartConfig,
  type DitherColor,
} from "@/components/dither-kit";
import { rgb, seedOfColor } from "@/components/dither-kit/palette";
import {
  EChartsComposedChart,
  type ChartConfig as EChartsChartConfig,
} from "@/components/evilcharts/charts/echarts-composed-chart";
import {
  formatCompact,
  formatDuration,
  formatPercent,
  formatTokens,
  formatUsd,
} from "@/lib/activity/format";
import type {
  ActivityBudget,
  ActivityDashboard,
  ActivityEmailMixItem,
  ActivitySender,
  ActivityStats,
  ActivityTokenDay,
} from "@/lib/activity/types";
import { cn } from "@/lib/utils";

/**
 * The client islands of the Activity board. Everything that needs state — the
 * metric tabs, the range control, the highlight view switch — lives here; the
 * page itself renders on the server and these hydrate on demand.
 *
 * The time-series (Overview trend) and the Highlights charts are drawn by the
 * ECharts composed chart, whose bar and line series resolve their colors from
 * the injected `--color-*` vars at runtime. The budget donut stays on dither-kit
 * (ECharts has no dither painter), so the two systems share one palette.
 */

/**
 * The dither palette, as plain hexes, handed to ECharts so its bars and lines
 * and the dither charts elsewhere on the board share one colour language.
 */
const EVIL_HUES = {
  green: "#28d26e",
  blue: "#358ff3",
  purple: "#966eff",
  pink: "#f05abe",
  orange: "#ff9632",
  red: "#f04646",
  mint: "#6ee7b7",
} as const;

/** A spread of hues for the inbox mix, so its bars are the most colourful. */
const MIX_HUES = [
  EVIL_HUES.pink,
  EVIL_HUES.blue,
  EVIL_HUES.green,
  EVIL_HUES.orange,
  EVIL_HUES.purple,
  EVIL_HUES.red,
];

/** Bar-chart category labels collide below ~640px, so thin them out there. */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

/* ------------------------------------------------------------------ */
/*  Overview: four metric tabs over one composed trend chart           */
/* ------------------------------------------------------------------ */

type MetricKey = "tokens" | "runs" | "success" | "latency";

const METRICS: Array<{
  key: MetricKey;
  label: string;
  color: DitherColor;
}> = [
  { key: "tokens", label: "Tokens", color: "blue" },
  { key: "runs", label: "Runs", color: "blue" },
  { key: "success", label: "Success rate", color: "green" },
  { key: "latency", label: "Avg run time", color: "orange" },
];

/** Per-metric palette + label contract for the composed trend chart. */
const TREND_CONFIG: Record<MetricKey, EChartsChartConfig> = {
  tokens: {
    prompt: { label: "Prompt", colors: { dark: [EVIL_HUES.blue] } },
    completion: { label: "Completion", colors: { dark: [EVIL_HUES.pink] } },
  },
  runs: {
    runs: { label: "Runs", colors: { dark: [EVIL_HUES.green] } },
    completed: { label: "Clean", colors: { dark: [EVIL_HUES.mint] } },
  },
  success: {
    success: { label: "Success rate", colors: { dark: [EVIL_HUES.green] } },
  },
  latency: {
    latency: { label: "Avg run time", colors: { dark: [EVIL_HUES.orange] } },
  },
};

/** Latency ticks read "0" at the floor rather than the formatter's "—". */
function axisDuration(value: number): string {
  return value <= 0 ? "0" : formatDuration(value);
}

function metricAxis(metric: MetricKey): (value: number) => string {
  if (metric === "tokens") return formatTokens;
  if (metric === "success") return (v) => `${Math.round(v)}%`;
  if (metric === "latency") return axisDuration;
  return (v) => formatCompact(v);
}

function rangeOptions(windowDays: number): Array<{ days: number; label: string }> {
  const wanted = [windowDays, 14, 7, 3, 1].filter(
    (days, index, all) => days <= windowDays && all.indexOf(days) === index,
  );
  return wanted.map((days) => ({ days, label: days === 1 ? "Today" : `${days}d` }));
}

/** The bar + line series the trend chart plots for the active metric. Returns an
 * ARRAY of elements, spread directly into the chart's children — the root walks
 * its children by reference, so a wrapper component or fragment would hide them
 * from it. */
function trendSeries(metric: MetricKey): ReactNode[] {
  if (metric === "tokens") {
    return [
      <EChartsComposedChart.Bar key="prompt" dataKey="prompt" variant="gradient" radius={3} />,
      <EChartsComposedChart.Line key="completion" dataKey="completion" curveType="smooth">
        <EChartsComposedChart.ActiveDot variant="colored-border" />
      </EChartsComposedChart.Line>,
    ];
  }
  if (metric === "runs") {
    return [
      <EChartsComposedChart.Bar key="runs" dataKey="runs" variant="gradient" radius={3} />,
      <EChartsComposedChart.Line key="completed" dataKey="completed" curveType="smooth">
        <EChartsComposedChart.ActiveDot variant="colored-border" />
      </EChartsComposedChart.Line>,
    ];
  }
  return [
    <EChartsComposedChart.Line key={metric} dataKey={metric} curveType="smooth" glow>
      <EChartsComposedChart.ActiveDot variant="colored-border" />
    </EChartsComposedChart.Line>,
  ];
}

export function OverviewPanel({
  stats,
  totals,
  deltas,
  daily,
  windowDays,
}: {
  stats: ActivityStats;
  totals: { runs: number; tokens: number; promptTokens: number; completionTokens: number };
  deltas: { runs: number; tokens: number };
  daily: ActivityTokenDay[];
  windowDays: number;
}) {
  const [metric, setMetric] = useState<MetricKey>("tokens");
  const [range, setRange] = useState(windowDays);

  const resolved = stats.completed + stats.failed + stats.limitReached;
  const options = useMemo(() => rangeOptions(windowDays), [windowDays]);
  const windowed = useMemo(() => daily.slice(-range), [daily, range]);

  const rows = useMemo(
    () =>
      windowed.map((day) => ({
        label: day.short,
        prompt: day.prompt,
        completion: day.completion,
        runs: day.runs,
        completed: day.completed,
        success: (day.successRate ?? 0) * 100,
        latency: day.avgLatencyMs,
      })),
    [windowed],
  );

  const tabs: Array<{
    key: MetricKey;
    label: string;
    value: string;
    pill: ReactNode;
  }> = [
    {
      key: "tokens",
      label: "Tokens",
      value: formatTokens(totals.tokens),
      pill: <DeltaPill value={deltas.tokens} />,
    },
    {
      key: "runs",
      label: "Runs",
      value: formatCompact(totals.runs),
      pill: <DeltaPill value={deltas.runs} />,
    },
    {
      key: "success",
      label: "Success rate",
      value: resolved > 0 ? formatPercent(stats.successRate) : "—",
      pill: (
        <InfoPill tone={resolved > 0 && stats.successRate < 0.9 ? "warn" : "neutral"}>
          {resolved > 0 ? `${stats.completed}/${resolved} clean` : "no runs yet"}
        </InfoPill>
      ),
    },
    {
      key: "latency",
      label: "Avg run time",
      value: formatDuration(stats.avgLatencyMs),
      pill: <InfoPill>{stats.avgSteps} steps avg</InfoPill>,
    },
  ];

  const active = METRICS.find((m) => m.key === metric)!;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3.5">
      {/* Metric tabs — pick the series the trend chart plots. Soft segmented
          tiles that share one recessed track. */}
      <div className="grid shrink-0 grid-cols-2 gap-1 rounded-xl bg-foreground/[0.03] p-1 ring-1 ring-border/70 sm:grid-cols-4">
        {tabs.map((tab) => {
          const isActive = tab.key === metric;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMetric(tab.key)}
              aria-pressed={isActive}
              className={cn(
                "flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                isActive
                  ? "bg-foreground/[0.07] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]"
                  : "hover:bg-foreground/[0.03]",
              )}
            >
              <p className="truncate text-[10.5px] font-medium text-muted-foreground">
                {tab.label}
              </p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-[17px] font-semibold leading-none tracking-tight tabular-nums text-foreground lg:text-[19px]">
                  {tab.value}
                </p>
                {tab.pill}
              </div>
            </button>
          );
        })}
      </div>

      <div className="min-h-[120px] flex-1">
        <EChartsComposedChart
          data={rows}
          config={TREND_CONFIG[metric]}
          xDataKey="label"
          curveType="smooth"
          barCategoryGap="35%"
          className="h-full w-full"
        >
          <EChartsComposedChart.Grid />
          <EChartsComposedChart.XAxis dataKey="label" />
          <EChartsComposedChart.YAxis tickFormatter={metricAxis(metric)} />
          <EChartsComposedChart.Tooltip />
          {trendSeries(metric)}
        </EChartsComposedChart>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
        <RangeControl options={options} value={range} onChange={setRange} />
        <span className="text-[11px] text-muted-foreground">
          {active.label} · {range === 1 ? "today" : `last ${range} days`}
        </span>
      </footer>
    </div>
  );
}

function RangeControl({
  options,
  value,
  onChange,
}: {
  options: Array<{ days: number; label: string }>;
  value: number;
  onChange: (days: number) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Time range"
      className="inline-flex rounded-lg bg-foreground/[0.04] p-0.5 ring-1 ring-border"
    >
      {options.map((option) => {
        const isActive = option.days === value;
        return (
          <button
            key={option.days}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.days)}
            className={cn(
              "cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
              isActive
                ? "bg-foreground/[0.08] text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Signals: where the AI budget went today                            */
/* ------------------------------------------------------------------ */

export function BudgetPanel({ budget }: { budget: ActivityBudget }) {
  const config = useMemo<ChartConfig>(() => {
    const next: ChartConfig = {};
    for (const slice of budget.breakdown) {
      next[slice.key] = { label: slice.label, color: slice.color };
    }
    return next;
  }, [budget.breakdown]);

  const data = useMemo(
    () => budget.breakdown.map((slice) => ({ name: slice.key, value: slice.calls })),
    [budget.breakdown],
  );

  const values = useMemo(
    () =>
      Object.fromEntries(
        budget.breakdown.map((slice) => [slice.key, slice.calls]),
      ),
    [budget.breakdown],
  );

  const spent = useMemo(
    () => budget.breakdown.filter((slice) => !slice.reserved && slice.calls > 0),
    [budget.breakdown],
  );

  const remainingShare =
    budget.dailyLimit > 0 ? budget.dailyRemaining / budget.dailyLimit : 0;
  const health =
    remainingShare > 0.4 ? "good" : remainingShare > 0.15 ? "warn" : "low";
  const healthClass =
    health === "good"
      ? "text-emerald-400"
      : health === "warn"
        ? "text-warning"
        : "text-destructive";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-end justify-between gap-3">
        <div>
          <p
            className={cn(
              "text-[20px] font-semibold leading-none tracking-tight tabular-nums",
              healthClass,
            )}
          >
            {formatCompact(budget.dailyRemaining)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">calls left today</p>
        </div>
        <div className="text-right">
          <p className="text-[13px] font-medium tabular-nums text-foreground">
            {formatCompact(budget.dailyUsed)} / {formatCompact(budget.dailyLimit)}
          </p>
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            {budget.disabled ? "guard off" : `${formatPercent(budget.percentUsed)} used`}
          </p>
        </div>
      </div>

      {/* One segment per activity, painted in the donut's own palette — so a
          run of categories reads as a colour bar before it is ever read. */}
      <div
        role="img"
        aria-label="Today's call allocation"
        className="flex h-1.5 w-full shrink-0 gap-px overflow-hidden rounded-full bg-foreground/[0.07]"
      >
        {spent.map((slice) => (
          <span
            key={slice.key}
            title={`${slice.label} · ${formatCompact(slice.calls)}`}
            style={{
              flexGrow: slice.calls,
              flexBasis: 0,
              minWidth: 3,
              backgroundColor: rgb(seedOfColor(slice.color).fill),
            }}
          />
        ))}
      </div>

      <div className="relative min-h-[96px] flex-1">
        <PieChart
          data={data}
          config={config}
          dataKey="value"
          nameKey="name"
          innerRadius={0.64}
          animate={false}
          bloom="aura"
          margins={{ top: 8, right: 8, bottom: 8, left: 8 }}
          className="h-full w-full"
        >
          <Pie variant="gradient" />
          <Tooltip valueFormatter={(value) => `${formatCompact(value)} calls`} />
        </PieChart>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p
              className={cn(
                "text-[18px] font-semibold leading-none tabular-nums",
                healthClass,
              )}
            >
              {formatPercent(budget.percentUsed)}
            </p>
            <p className="mt-1 text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
              used
            </p>
          </div>
        </div>
      </div>

      <BlockLegend
        config={config}
        values={values}
        valueFormatter={(value) => formatCompact(value)}
        className="shrink-0 gap-x-3"
      />

      <p className="mt-auto shrink-0 border-t border-border/60 pt-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
        {budget.attributed
          ? `Today's model calls by activity · ≈ ${formatUsd(budget.estimatedCostUsd)} est. spend · resets at midnight UTC.`
          : "Ledger unavailable — showing the daily guard counter. Resets at midnight UTC."}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Highlights: top senders, inbox mix and your rhythm                 */
/* ------------------------------------------------------------------ */

type HighlightView = "senders" | "mix" | "rhythm";
type SenderRange = "week" | "month";

const HIGHLIGHT_TABS: Array<{
  key: HighlightView;
  label: string;
  color: DitherColor;
}> = [
  { key: "senders", label: "Top senders", color: "green" },
  { key: "mix", label: "Inbox mix", color: "pink" },
  { key: "rhythm", label: "Your rhythm", color: "orange" },
];

/**
 * Truncate a category label so axis ticks can never collide. Applied at every
 * width (not just narrow ones) — long email local-parts are the usual cause of
 * overlapping labels under a bar chart.
 */
function fitTick(value: unknown, maxChars: number): string {
  const text = String(value ?? "");
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

/** A compact figure used in the rhythm callouts. */
function MiniStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate text-[14px] font-semibold leading-none tabular-nums text-foreground">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 truncate text-[10.5px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

const SENDER_CONFIG = {
  messages: {
    label: "Emails",
    colors: { dark: [EVIL_HUES.green, EVIL_HUES.mint] },
  },
} satisfies EChartsChartConfig;

const MIX_CONFIG = {
  value: {
    label: "Emails",
    colors: { dark: MIX_HUES },
  },
} satisfies EChartsChartConfig;

const RHYTHM_CONFIG = {
  runs: {
    label: "Runs",
    colors: { dark: [EVIL_HUES.pink, EVIL_HUES.orange] },
  },
  completed: {
    label: "Clean",
    colors: { dark: [EVIL_HUES.mint] },
  },
} satisfies EChartsChartConfig;

export function HighlightsPanel({
  senders,
  emailMix,
  daily,
  peak,
  busiestDay,
  streak,
}: {
  senders: { week: ActivitySender[]; month: ActivitySender[] };
  emailMix: ActivityEmailMixItem[];
  daily: ActivityTokenDay[];
  peak: ActivityDashboard["peak"];
  busiestDay: ActivityDashboard["busiestDay"];
  streak: number;
}) {
  const [view, setView] = useState<HighlightView>("senders");
  const [senderRange, setSenderRange] = useState<SenderRange>("week");
  const narrow = useIsNarrow();

  /* ---- top senders ---- */
  const senderRows = useMemo(
    () =>
      (senders[senderRange] ?? []).map((sender) => ({
        label: sender.label,
        email: sender.email,
        messages: sender.messages,
      })),
    [senders, senderRange],
  );
  const senderTotal = useMemo(
    () => senderRows.reduce((total, row) => total + row.messages, 0),
    [senderRows],
  );

  /* ---- inbox mix ---- */
  const mixRows = useMemo(() => {
    const head = emailMix.slice(0, 5);
    const rest = emailMix
      .slice(5)
      .reduce((total, item) => total + item.count, 0);
    const rows = head.map((item) => ({
      label: item.label,
      value: item.count,
    }));
    if (rest > 0) {
      rows.push({ label: "Everything else", value: rest });
    }
    return rows;
  }, [emailMix]);
  const mixTotal = useMemo(
    () => mixRows.reduce((total, row) => total + row.value, 0),
    [mixRows],
  );

  /* ---- rhythm ---- */
  const rhythmRows = useMemo(
    () =>
      daily.slice(-7).map((day) => ({
        label: day.short,
        runs: day.runs,
        completed: day.completed,
      })),
    [daily],
  );
  const rhythmTotal = useMemo(
    () => rhythmRows.reduce((total, row) => total + row.runs, 0),
    [rhythmRows],
  );

  const empty =
    view === "senders"
      ? senderRows.length === 0
      : view === "mix"
        ? mixRows.length === 0
        : rhythmTotal === 0;

  const footer =
    view === "senders"
      ? {
          note:
            senderRange === "week"
              ? "Top inbound senders this week"
              : "Top inbound senders this month",
          total: `${formatCompact(senderTotal)} emails`,
        }
      : view === "mix"
        ? {
            note: "What landed in your inbox",
            total: `${formatCompact(mixTotal)} received`,
          }
        : {
            note: "When you put the operator to work",
            total: `${formatCompact(rhythmTotal)} runs`,
          };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="scrollbar-none flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-foreground/[0.03] p-0.5 ring-1 ring-border/70">
          {HIGHLIGHT_TABS.map((tab) => {
            const isActive = tab.key === view;
            return (
              <button
                key={tab.key}
                type="button"
                aria-pressed={isActive}
                onClick={() => setView(tab.key)}
                className={cn(
                  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
                  isActive
                    ? "bg-foreground/[0.08] text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{
                    backgroundColor: rgb(seedOfColor(tab.color).fill),
                  }}
                  aria-hidden
                />
                {tab.label}
              </button>
            );
          })}
        </div>

        {view === "senders" ? (
          <div
            role="group"
            aria-label="Sender period"
            className="inline-flex rounded-lg bg-foreground/[0.04] p-0.5 ring-1 ring-border"
          >
            {(["week", "month"] as const).map((range) => {
              const isActive = range === senderRange;
              return (
                <button
                  key={range}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setSenderRange(range)}
                  className={cn(
                    "cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                    isActive
                      ? "bg-foreground/[0.08] text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {range === "week" ? "This week" : "This month"}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {empty ? (
        <div className="flex min-h-0 flex-1 items-center">
          <EmptyPanel title="Nothing here yet">
            {view === "senders"
              ? "Top senders appear once mail has arrived in the selected period."
              : view === "mix"
                ? "Your inbox mix appears once mail starts arriving."
                : "Your rhythm appears once the operator has run."}
          </EmptyPanel>
        </div>
      ) : view === "senders" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5">
          <div className="min-h-[120px] flex-1">
            <EChartsComposedChart
              data={senderRows}
              config={SENDER_CONFIG}
              xDataKey="label"
              barCategoryGap="30%"
              className="h-full w-full"
            >
              <EChartsComposedChart.Grid />
              <EChartsComposedChart.XAxis
                dataKey="label"
                tickFormatter={(value) => fitTick(value, narrow ? 8 : 11)}
              />
              <EChartsComposedChart.YAxis
                tickFormatter={(value) => formatCompact(Number(value))}
              />
              <EChartsComposedChart.Tooltip />
              <EChartsComposedChart.Bar dataKey="messages" variant="gradient" radius={3} />
            </EChartsComposedChart>
          </div>
          {/* Full addresses live in a wrapping list: never overlaps, always legible. */}
          <ul className="scrollbar-none flex max-h-[56px] shrink-0 flex-wrap gap-x-4 gap-y-1.5 overflow-y-auto">
            {senderRows.map((row) => (
              <li
                key={row.email}
                className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground"
              >
                <span className="max-w-[22ch] truncate text-foreground">
                  {row.email}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatCompact(row.messages)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : view === "mix" ? (
        <div className="min-h-[120px] flex-1">
          <EChartsComposedChart
            data={mixRows}
            config={MIX_CONFIG}
            xDataKey="label"
            barCategoryGap="30%"
            className="h-full w-full"
          >
            <EChartsComposedChart.Grid />
            <EChartsComposedChart.XAxis
              dataKey="label"
              tickFormatter={(value) => fitTick(value, narrow ? 8 : 12)}
            />
            <EChartsComposedChart.YAxis
              tickFormatter={(value) => formatCompact(Number(value))}
            />
            <EChartsComposedChart.Tooltip />
            <EChartsComposedChart.Bar dataKey="value" variant="gradient" radius={3} />
          </EChartsComposedChart>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="min-h-[110px] flex-1">
            <EChartsComposedChart
              data={rhythmRows}
              config={RHYTHM_CONFIG}
              xDataKey="label"
              curveType="smooth"
              barCategoryGap="35%"
              className="h-full w-full"
            >
              <EChartsComposedChart.Grid />
              <EChartsComposedChart.XAxis dataKey="label" />
              <EChartsComposedChart.YAxis
                tickFormatter={(value) => formatCompact(Number(value))}
              />
              <EChartsComposedChart.Tooltip />
              <EChartsComposedChart.Bar dataKey="runs" variant="gradient" radius={3} />
              <EChartsComposedChart.Line dataKey="completed">
                <EChartsComposedChart.ActiveDot variant="colored-border" />
              </EChartsComposedChart.Line>
            </EChartsComposedChart>
          </div>
          <div className="grid shrink-0 grid-cols-3 gap-3 border-t border-border/60 pt-3">
            <MiniStat
              label="Busiest day"
              value={busiestDay?.label ?? "—"}
              hint={
                busiestDay
                  ? `${formatCompact(busiestDay.count)} runs`
                  : "no runs yet"
              }
            />
            <MiniStat
              label="Peak window"
              value={peak?.window ?? "—"}
              hint={peak ? peak.day : undefined}
            />
            <MiniStat
              label="Day streak"
              value={String(streak)}
              hint={streak === 1 ? "day in a row" : "days in a row"}
            />
          </div>
        </div>
      )}

      <footer className="mt-auto flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border/60 pt-3">
        <span className="text-[11px] text-muted-foreground">{footer.note}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {footer.total}
        </span>
      </footer>
    </div>
  );
}
