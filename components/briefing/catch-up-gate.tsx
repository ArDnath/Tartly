"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { CatchUpOverlay } from "@/components/briefing/catch-up-overlay";
import { openAssistantCatchUp } from "@/components/assistant/assistant-events";
import type { CatchUp } from "@/lib/briefing/catchup-types";

/**
 * Decides whether the catch-up popup should appear on this app load.
 *
 * Mounted once in `AppShell`, so it rides along on every screen. It shows at
 * most once per local day: opening the catch-up (`ACK`) or choosing "Later"
 * (`LATER`) records today's key, and the popup stays down until tomorrow. The
 * store is local because this is a per-browser nudge, not user state the server
 * needs to know about.
 *
 * It never blocks the app: the fetch is best-effort, the popup is client-only,
 * and an empty or unreachable briefing simply shows nothing.
 */
const ACK_KEY = "lunabox:catchup:ack";
const LATER_KEY = "lunabox:catchup:later";

function localDayKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode / disabled storage: the popup may reappear, which is fine.
  }
}

export function CatchUpGate() {
  const router = useRouter();
  const [catchUp, setCatchUp] = useState<CatchUp | null>(null);

  useEffect(() => {
    const day = localDayKey();
    if (readKey(ACK_KEY) === day || readKey(LATER_KEY) === day) return;

    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/v1/briefing", {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          data?: { catchUp?: CatchUp };
        };
        const next = payload.data?.catchUp;
        // Only interrupt when there is genuinely something to say.
        if (!cancelled && next && next.total > 0) setCatchUp(next);
      } catch {
        // Offline or request aborted — the app loads without the popup.
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  if (!catchUp) return null;

  return (
    <CatchUpOverlay
      catchUp={catchUp}
      onCatchUp={() => {
        writeKey(ACK_KEY, localDayKey());
        const plan = catchUp;
        setCatchUp(null);
        // Continue in the mail agent sidebar when it is on screen; only fall
        // back to a route change when no agent panel is mounted here.
        if (!openAssistantCatchUp({ catchUp: plan })) {
          router.push("/mail?catchup=1");
        }
      }}
      onLater={() => {
        writeKey(LATER_KEY, localDayKey());
        setCatchUp(null);
      }}
    />
  );
}
