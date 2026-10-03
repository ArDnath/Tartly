"use client";

import { Loader2, Moon, PauseCircle, PlayCircle } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export type AutopilotPolicyView = {
  enabled: boolean;
  mode: "window" | "always";
  timezone: string;
  days: number[];
  windowStartHour: number;
  windowEndHour: number;
  minConfidence: "HIGH" | "MEDIUM" | "LOW";
  requireKnownSender: boolean;
  allowedCategories: string[];
  maxPerHour: number;
  maxPerDay: number;
  maxPerThread: number;
  loopThreshold: number;
  morningReview: boolean;
};

type PreviewRow = {
  threadId: string;
  subject: string | null;
  from: string | null;
  decision: "send" | "draft";
  reason: string;
  checks: Record<string, boolean>;
};

const DAYS = [
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "W" },
  { value: 4, label: "T" },
  { value: 5, label: "F" },
  { value: 6, label: "S" },
  { value: 7, label: "S" },
];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

const CATEGORY_LABELS: Record<string, string> = {
  needs_reply: "Needs a reply",
  meeting_request: "Meeting request",
  awaiting_reply: "Awaiting their reply",
  fyi: "FYI",
  invoice: "Invoice",
  newsletter: "Newsletter",
  spam: "Spam",
};

function reasonLabel(
  reason: string,
  labels: Record<string, string>,
): string {
  if (reason.startsWith("guardrails:")) return "Held for review: risky content";
  return labels[reason] ?? "Held for review";
}

export function AutopilotSettingsForm({
  initial,
  globalEnabled,
  categories,
  reasonLabels,
}: {
  initial: AutopilotPolicyView;
  globalEnabled: boolean;
  categories: readonly string[];
  reasonLabels: Record<string, string>;
}) {
  const [values, setValues] = useState<AutopilotPolicyView>(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const patch = (next: Partial<AutopilotPolicyView>) =>
    setValues((current) => ({ ...current, ...next }));

  const toggleDay = (day: number) =>
    patch({
      days: values.days.includes(day)
        ? values.days.filter((value) => value !== day)
        : [...values.days, day].sort((a, b) => a - b),
    });

  const toggleCategory = (category: string) =>
    patch({
      allowedCategories: values.allowedCategories.includes(category)
        ? values.allowedCategories.filter((value) => value !== category)
        : [...values.allowedCategories, category],
    });

  const save = async (override?: Partial<AutopilotPolicyView>) => {
    const next = { ...values, ...override };
    setValues(next);
    setStatus("saving");
    try {
      const response = await fetch("/api/v1/settings/autopilot", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      setStatus(response.ok ? "saved" : "error");
    } catch {
      setStatus("error");
    }
  };

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const response = await fetch("/api/v1/settings/autopilot/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 10 }),
      });
      const payload = await response.json().catch(() => null);
      setPreview(payload?.data?.rows ?? []);
    } catch {
      setPreview([]);
    } finally {
      setPreviewing(false);
    }
  };

  const pauseAll = async () => {
    setStatus("saving");
    try {
      const response = await fetch("/api/v1/settings/autopilot/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alsoSetCopilot: true }),
      });
      if (response.ok) {
        setValues((current) => ({ ...current, enabled: false }));
        setStatus("saved");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="flex w-full flex-col gap-8">
      {!globalEnabled ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
          Automatic sending is turned off platform-wide. Your settings are saved
          but nothing will send until it is re-enabled.
        </div>
      ) : null}

      {/* Master switch */}
      <section className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-[14px] font-medium text-foreground">
            24/7 Autopilot
          </h2>
          <p className="max-w-prose text-[13px] leading-relaxed text-muted-foreground">
            When this is on, Lunabox can send replies on its own inside the
            window below. Anything risky becomes a draft instead. You can pause
            this at any time.
          </p>
        </div>
        <Switch
          checked={values.enabled}
          onCheckedChange={(checked) => save({ enabled: checked })}
          aria-label="Enable 24/7 Autopilot"
        />
      </section>

      <div
        className={cn(
          "flex flex-col gap-8 transition-opacity",
          values.enabled ? "opacity-100" : "pointer-events-none opacity-50",
        )}
        aria-disabled={!values.enabled}
      >
        {/* When */}
        <section className="flex flex-col gap-3">
          <h3 className="text-[13px] font-semibold text-foreground">When</h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Mode
              <select
                value={values.mode}
                onChange={(event) =>
                  patch({ mode: event.target.value as "window" | "always" })
                }
                className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
              >
                <option value="window">Only inside the window (recommended)</option>
                <option value="always">Any time</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Timezone
              <Input
                value={values.timezone}
                onChange={(event) => patch({ timezone: event.target.value })}
                aria-describedby="autopilot-tz-help"
              />
            </label>
          </div>
          <p id="autopilot-tz-help" className="text-[11px] text-muted-foreground">
            Use an IANA name, e.g. <code>America/New_York</code>.
          </p>

          {values.mode === "always" ? (
            <div
              role="note"
              className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400"
            >
              &ldquo;Any time&rdquo; lets Lunabox send around the clock, including
              at night. Most people should use a window.
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Days</span>
            <div className="flex gap-1.5">
              {DAYS.map((day, index) => (
                <button
                  key={`${day.value}-${index}`}
                  type="button"
                  aria-pressed={values.days.includes(day.value)}
                  onClick={() => toggleDay(day.value)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg border text-xs transition-colors",
                    values.days.includes(day.value)
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-accent",
                  )}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Sending starts
              <select
                value={values.windowStartHour}
                onChange={(event) =>
                  patch({ windowStartHour: Number(event.target.value) })
                }
                className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
              >
                {HOURS.map((hour) => (
                  <option key={hour} value={hour}>
                    {String(hour).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Sending ends
              <select
                value={values.windowEndHour}
                onChange={(event) =>
                  patch({ windowEndHour: Number(event.target.value) })
                }
                className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
              >
                {HOURS.map((hour) => (
                  <option key={hour} value={hour}>
                    {String(hour).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {/* What it may send */}
        <section className="flex flex-col gap-3">
          <h3 className="text-[13px] font-semibold text-foreground">
            What it may send
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Minimum confidence
              <select
                value={values.minConfidence}
                onChange={(event) =>
                  patch({
                    minConfidence: event.target.value as
                      | "HIGH"
                      | "MEDIUM"
                      | "LOW",
                  })
                }
                className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
              >
                <option value="HIGH">High only</option>
                <option value="MEDIUM">Medium or high</option>
                <option value="LOW">Any</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-[13px]">
              <span className="text-muted-foreground">Only known senders</span>
              <Switch
                checked={values.requireKnownSender}
                onCheckedChange={(checked) =>
                  patch({ requireKnownSender: checked })
                }
                aria-label="Only auto-reply to known senders"
              />
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              Categories it may auto-send
            </span>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((category) => {
                const active = values.allowedCategories.includes(category);
                return (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleCategory(category)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[12px] transition-colors",
                      active
                        ? "border-transparent bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {CATEGORY_LABELS[category] ?? category}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Max per hour
              <Input
                type="number"
                min={1}
                value={values.maxPerHour}
                onChange={(event) =>
                  patch({ maxPerHour: Number(event.target.value) })
                }
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Max per day
              <Input
                type="number"
                min={1}
                value={values.maxPerDay}
                onChange={(event) =>
                  patch({ maxPerDay: Number(event.target.value) })
                }
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Max per thread
              <Input
                type="number"
                min={1}
                value={values.maxPerThread}
                onChange={(event) =>
                  patch({ maxPerThread: Number(event.target.value) })
                }
              />
            </label>
          </div>
        </section>

        {/* Morning review */}
        <section className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Moon className="size-4 text-muted-foreground" aria-hidden />
            <div className="flex flex-col">
              <span className="text-[13px] text-foreground">
                Morning review
              </span>
              <span className="text-[12px] text-muted-foreground">
                Show what was sent or held while you were away.
              </span>
            </div>
          </div>
          <Switch
            checked={values.morningReview}
            onCheckedChange={(checked) => patch({ morningReview: checked })}
            aria-label="Enable the morning review"
          />
        </section>

        {/* Preview */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-semibold text-foreground">
              Preview
            </h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={runPreview}
              disabled={previewing}
            >
              {previewing ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <PlayCircle className="size-4" aria-hidden />
              )}
              Run preview
            </Button>
          </div>
          <p className="text-[12px] text-muted-foreground">
            A dry run over recent threads. Nothing is sent or changed.
          </p>

          {preview === null ? null : preview.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              No recent reply-worthy threads to preview.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Thread</th>
                    <th className="px-3 py-2 font-medium">Decision</th>
                    <th className="px-3 py-2 font-medium">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row) => (
                    <tr
                      key={row.threadId}
                      className="border-t border-border"
                    >
                      <td className="max-w-[220px] truncate px-3 py-2 text-foreground">
                        {row.subject ?? row.from ?? row.threadId}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={row.decision === "send" ? "default" : "secondary"}
                        >
                          {row.decision === "send" ? "Would send" : "Draft"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {reasonLabel(row.reason, reasonLabels)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Actions */}
      <section className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
        <Button type="button" onClick={() => save()} disabled={status === "saving"}>
          {status === "saving" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : null}
          Save
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={pauseAll}
          disabled={status === "saving"}
        >
          <PauseCircle className="size-4" aria-hidden />
          Pause all automatic sending
        </Button>
        {status === "saved" ? (
          <span className="text-xs text-muted-foreground">Saved.</span>
        ) : null}
        {status === "error" ? (
          <span className="text-xs text-destructive">Could not save.</span>
        ) : null}
      </section>
    </div>
  );
}
