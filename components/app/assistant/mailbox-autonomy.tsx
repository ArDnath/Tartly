"use client";

import { Settings2, ShieldCheckIcon, ZapIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The mailbox autonomy mode, surfaced in the chat composer.
 *
 * Copilot and Autopilot are not chat-local: they are the mailbox-wide setting
 * the background email operator reads too. This module keeps a tiny client
 * store so every mounted composer (the `/assistant` page and the mail side
 * panel) shows the same value and a toggle in one is reflected in the other
 * without a refetch.
 */

export type MailboxAutonomy = "copilot" | "autopilot";

type AutonomyState = {
  autonomy: MailboxAutonomy;
  /** True once the server value has been read at least once. */
  loaded: boolean;
  saving: boolean;
  /** A non-blocking save/read failure. Never rendered as an error state. */
  failed: boolean;
};

const INITIAL: AutonomyState = {
  autonomy: "copilot",
  loaded: false,
  saving: false,
  failed: false,
};

let state: AutonomyState = INITIAL;
const listeners = new Set<() => void>();

function emit(patch: Partial<AutonomyState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

function getServerSnapshot() {
  return INITIAL;
}

let loadPromise: Promise<void> | null = null;

/** Read the mailbox mode once; later callers reuse the in-flight/settled value. */
export function loadMailboxAutonomy(): Promise<void> {
  if (state.loaded) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = fetch("/api/v1/settings/autonomy", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error("Failed to load autonomy.");
      return (await response.json()) as {
        data?: { mailboxAutonomy?: MailboxAutonomy };
      };
    })
    .then((payload) => {
      emit({
        autonomy:
          payload.data?.mailboxAutonomy === "autopilot" ? "autopilot" : "copilot",
        loaded: true,
        failed: false,
      });
    })
    .catch(() => {
      emit({ loaded: true, failed: true });
    })
    .finally(() => {
      loadPromise = null;
    });

  return loadPromise;
}

/** Optimistically flip the mode and persist it. Rolls back on failure. */
export async function writeMailboxAutonomy(
  next: MailboxAutonomy,
): Promise<void> {
  const previous = state.autonomy;
  if (previous === next && !state.failed) return;

  emit({ autonomy: next, saving: true, failed: false });
  try {
    const response = await fetch("/api/v1/settings/autonomy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mailboxAutonomy: next }),
    });
    if (!response.ok) throw new Error("Failed to save autonomy.");
    emit({ saving: false });
  } catch {
    emit({ autonomy: previous, saving: false, failed: true });
  }
}

export function useMailboxAutonomy(): AutonomyState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

const OPTIONS: Array<{
  value: MailboxAutonomy;
  label: string;
  icon: typeof ShieldCheckIcon;
  description: string;
}> = [
  {
    value: "copilot",
    label: "Copilot",
    icon: ShieldCheckIcon,
    description:
      "Drafts and asks for approval before anything is sent. The safe default.",
  },
  {
    value: "autopilot",
    label: "Autopilot",
    icon: ZapIcon,
    description:
      "Replies, sends and schedules on its own — still logged and guardrailed. Use for long-running threads.",
  },
];

/**
 * The Copilot / Autopilot segmented control that lives in the chat composer.
 * It is the single place the mode is chosen now; Settings no longer has its
 * own copy.
 */
export function AutonomySwitch({ className }: { className?: string }) {
  const { autonomy, loaded, saving, failed } = useMailboxAutonomy();

  useEffect(() => {
    void loadMailboxAutonomy();
  }, []);

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <div
        role="radiogroup"
        aria-label="Autonomy mode"
        aria-busy={saving}
        className={cn(
          "flex items-center rounded-full border border-border bg-muted/40 p-0.5",
          !loaded && "opacity-60",
        )}
      >
        {OPTIONS.map((option) => {
          const active = autonomy === option.value;
          const Icon = option.icon;
          return (
            <Tooltip key={option.value}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => void writeMailboxAutonomy(option.value)}
                    className={cn(
                      "flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium transition-colors",
                      active
                        ? option.value === "autopilot"
                          ? "bg-foreground text-background"
                          : "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden />
                    <span className="hidden sm:inline">{option.label}</span>
                    <span className="sr-only sm:hidden">{option.label}</span>
                  </button>
                }
              />
              <TooltipContent side="top" className="max-w-56">
                {option.description}
              </TooltipContent>
            </Tooltip>
          );
        })}
        {failed ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  aria-hidden
                  className="ml-1 mr-1.5 size-1.5 shrink-0 rounded-full bg-amber-500"
                />
              }
            />
            <TooltipContent side="top">
              Couldn&apos;t save the mode. It will stay on the last saved value.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              href="/settings/autopilot"
              aria-label="24/7 Autopilot settings"
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            >
              <Settings2 className="size-3.5" aria-hidden />
            </Link>
          }
        />
        <TooltipContent side="top">
          Set the send window and limits for 24/7 Autopilot
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
