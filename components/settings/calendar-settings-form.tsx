"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CalendarSettingsValues } from "@/lib/calendar/defaults";
import { cn } from "@/lib/utils";

const WORK_DAYS = [
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "W" },
  { value: 4, label: "T" },
  { value: 5, label: "F" },
  { value: 6, label: "S" },
  { value: 7, label: "S" },
];

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const DURATIONS = [15, 30, 45, 60];
const BUFFERS = [0, 5, 10, 15, 30];

export function CalendarSettingsForm({
  initial,
}: {
  initial: CalendarSettingsValues;
}) {
  const [values, setValues] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  const toggleDay = (day: number) => {
    setValues((current) => ({
      ...current,
      workDays: current.workDays.includes(day)
        ? current.workDays.filter((value) => value !== day)
        : [...current.workDays, day].sort((a, b) => a - b),
    }));
  };

  const save = async () => {
    setStatus("saving");
    try {
      const response = await fetch("/api/v1/settings/calendar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      setStatus(response.ok ? "saved" : "error");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="flex w-full flex-col gap-5">
      <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        Timezone
        <Input
          value={values.timezone}
          onChange={(event) =>
            setValues((current) => ({ ...current, timezone: event.target.value }))
          }
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Working days</span>
        <div className="flex gap-1.5">
          {WORK_DAYS.map((day, index) => (
            <button
              key={`${day.value}-${index}`}
              type="button"
              aria-pressed={values.workDays.includes(day.value)}
              onClick={() => toggleDay(day.value)}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg border text-xs transition-colors",
                values.workDays.includes(day.value)
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
          Start
          <select
            value={values.workStartHour}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                workStartHour: Number(event.target.value),
              }))
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
          End
          <select
            value={values.workEndHour}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                workEndHour: Number(event.target.value),
              }))
            }
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
          >
            {HOURS.map((hour) => (
              <option key={hour} value={hour + 1}>
                {String(hour + 1).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          Default length
          <select
            value={values.defaultDurationMins}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                defaultDurationMins: Number(event.target.value),
              }))
            }
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
          >
            {DURATIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} min
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          Buffer
          <select
            value={values.bufferMins}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                bufferMins: Number(event.target.value),
              }))
            }
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
          >
            {BUFFERS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} min
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={status === "saving"}>
          {status === "saving" ? <Loader2 className="size-4 animate-spin" /> : null}
          Save
        </Button>
        {status === "saved" ? (
          <span className="text-xs text-muted-foreground">Saved.</span>
        ) : null}
        {status === "error" ? (
          <span className="text-xs text-destructive">Could not save.</span>
        ) : null}
      </div>
    </div>
  );
}
