"use client";

import { Moon, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

const KEY = "tartly:autopilot:optin";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

function remember(value: string): void {
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    // Private mode: the card may reappear, which is acceptable.
  }
}

/**
 * Post-onboarding opt-in, shown once on the inbox. It never reorders the
 * onboarding steps: it is a dismissible card whose default action keeps the
 * user in copilot. "Overnight cover" enables the policy with safe defaults.
 */
export function AutopilotOptInCard() {
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (readDismissed()) return;
    let cancelled = false;
    fetch("/api/v1/settings/autopilot", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (payload: {
          data?: { policy?: { enabled?: boolean }; globalEnabled?: boolean };
        } | null) => {
          if (cancelled) return;
          const enabled = payload?.data?.policy?.enabled === true;
          const global = payload?.data?.globalEnabled !== false;
          if (!enabled && global) setVisible(true);
        },
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = (value: string) => {
    remember(value);
    setVisible(false);
  };

  const enable = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/v1/settings/autopilot", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, morningReview: true }),
      });
      dismiss(response.ok ? "enabled" : "kept");
    } catch {
      dismiss("kept");
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="border-b border-border bg-canvas/60 px-5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-foreground/[0.06] text-foreground">
          <Moon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-foreground">
            Handle replies while you&apos;re away?
          </p>
          <p className="text-[12px] text-muted-foreground">
            24/7 Autopilot can send safe replies overnight inside a window you
            choose. Risky replies still become drafts, and you can pause anytime.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => dismiss("kept")}
            disabled={saving}
          >
            <ShieldCheck className="size-3.5" aria-hidden />
            Keep me in the loop
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={enable}
            disabled={saving}
          >
            <Moon className="size-3.5" aria-hidden />
            Overnight cover
          </Button>
        </div>
      </div>
    </div>
  );
}
