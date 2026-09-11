"use client";

import { Loader2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { useOnboarding } from "@/components/onboarding/onboarding-provider";
import { OnboardingSkipButton } from "@/components/onboarding/onboarding-skip-button";
import { OnboardingStepAnimatedItem } from "@/components/onboarding/onboarding-step-animated-item";
import {
  OnboardingContentBlock,
  OnboardingStepHeading,
  OnboardingStepPage,
  OnboardingStepSubtitle,
  OnboardingStepTitle,
} from "@/components/onboarding/onboarding-step-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_CALENDAR_SETTINGS } from "@/lib/calendar/defaults";
import { cn } from "@/lib/utils";

const WORK_DAY_LABELS: Array<{ value: number; label: string }> = [
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

function resolveDefaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** `useSyncExternalStore` needs a stable subscribe; this value never changes. */
const subscribeNoop = () => () => {};

export const CalendarSetupStep = () => {
  const { advance, isNavigating } = useOnboarding();
  // Read the browser timezone through `useSyncExternalStore` so SSR uses the
  // default (server TZ is irrelevant) and the client adopts the real one after
  // hydration — no render-time mismatch and no setState-in-effect.
  const detectedTimezone = useSyncExternalStore(
    subscribeNoop,
    resolveDefaultTimezone,
    () => DEFAULT_CALENDAR_SETTINGS.timezone,
  );
  const [timezoneOverride, setTimezoneOverride] = useState<string | null>(null);
  const timezone = timezoneOverride ?? detectedTimezone;
  const setTimezone = setTimezoneOverride;
  const [workDays, setWorkDays] = useState<number[]>(
    DEFAULT_CALENDAR_SETTINGS.workDays,
  );
  const [workStartHour, setWorkStartHour] = useState(
    DEFAULT_CALENDAR_SETTINGS.workStartHour,
  );
  const [workEndHour, setWorkEndHour] = useState(
    DEFAULT_CALENDAR_SETTINGS.workEndHour,
  );
  const [bufferMins, setBufferMins] = useState(
    DEFAULT_CALENDAR_SETTINGS.bufferMins,
  );
  const [defaultDurationMins, setDefaultDurationMins] = useState(
    DEFAULT_CALENDAR_SETTINGS.defaultDurationMins,
  );
  const [isSaving, setIsSaving] = useState(false);

  const toggleDay = (day: number) => {
    setWorkDays((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day)
        : [...current, day].sort((a, b) => a - b),
    );
  };

  const handleContinue = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/onboarding/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          timezone,
          workDays,
          workStartHour,
          workEndHour,
          bufferMins,
          defaultDurationMins,
        }),
      });

      if (!response.ok) throw new Error("Failed to save calendar settings");

      await advance({ action: "complete" });
    } catch (error) {
      console.error("[onboarding] failed to save calendar settings", error);
    } finally {
      setIsSaving(false);
    }
  };

  const disabled = isSaving || isNavigating || workDays.length === 0;

  return (
    <OnboardingStepPage>
      <OnboardingStepHeading>
        <OnboardingStepAnimatedItem index={0}>
          <OnboardingStepTitle>When can we book time?</OnboardingStepTitle>
        </OnboardingStepAnimatedItem>
        <OnboardingStepAnimatedItem index={1}>
          <OnboardingStepSubtitle>
            Your assistant only proposes meetings inside these hours.
          </OnboardingStepSubtitle>
        </OnboardingStepAnimatedItem>
      </OnboardingStepHeading>

      <OnboardingStepAnimatedItem index={2}>
        <OnboardingContentBlock className="gap-5">
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            Timezone
            <Input
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              placeholder="Europe/Berlin"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Working days</span>
            <div className="flex gap-1.5">
              {WORK_DAY_LABELS.map((day, index) => (
                <button
                  key={`${day.value}-${index}`}
                  type="button"
                  aria-pressed={workDays.includes(day.value)}
                  onClick={() => toggleDay(day.value)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg border text-xs transition-colors",
                    workDays.includes(day.value)
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
                value={workStartHour}
                onChange={(event) =>
                  setWorkStartHour(Number(event.target.value))
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
                value={workEndHour}
                onChange={(event) => setWorkEndHour(Number(event.target.value))}
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
              Meeting length
              <select
                value={defaultDurationMins}
                onChange={(event) =>
                  setDefaultDurationMins(Number(event.target.value))
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
                value={bufferMins}
                onChange={(event) => setBufferMins(Number(event.target.value))}
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

          <div className="flex items-center justify-between pt-1">
            <OnboardingSkipButton
              onClick={() => advance({ action: "skip" })}
              disabled={isSaving || isNavigating}
            />
            <Button type="button" onClick={handleContinue} disabled={disabled}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
              Continue
            </Button>
          </div>
        </OnboardingContentBlock>
      </OnboardingStepAnimatedItem>
    </OnboardingStepPage>
  );
};
