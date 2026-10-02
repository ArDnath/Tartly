"use client";

import { ShieldCheckIcon, Undo2Icon, ZapIcon } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Per-thread autonomy control, mounted in the inbox thread header.
 *
 * It always shows the *effective* mode and where it comes from (thread →
 * contact → mailbox), so the three-level precedence stays legible. Choosing a
 * mode writes a thread override; the reset button clears it back to inherit.
 */

type Autonomy = "copilot" | "autopilot";
type AutonomySource = "thread" | "contact" | "mailbox";

const SOURCE_LABEL: Record<AutonomySource, string> = {
  thread: "this thread",
  contact: "this contact",
  mailbox: "your mailbox",
};

export function ScopedAutonomySwitch({
  threadId,
  className,
}: {
  threadId: string;
  className?: string;
}) {
  const [override, setOverride] = useState<Autonomy | null>(null);
  const [effective, setEffective] = useState<Autonomy>("copilot");
  const [source, setSource] = useState<AutonomySource>("mailbox");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/threads/${threadId}/autonomy`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { data?: { autonomy: Autonomy | null; effective: Autonomy; source: AutonomySource } } | null) => {
        if (cancelled || !payload?.data) return;
        setOverride(payload.data.autonomy);
        setEffective(payload.data.effective);
        setSource(payload.data.source);
      })
      .catch(() => {
        // Leave the safe default; the switch still works optimistically.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const write = async (next: Autonomy | null) => {
    const previous = { override, effective, source };
    setOverride(next);
    setEffective(next ?? (source === "thread" ? "copilot" : effective));
    setSaving(true);
    try {
      const response = await fetch(`/api/v1/threads/${threadId}/autonomy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autonomy: next }),
      });
      if (!response.ok) throw new Error("save failed");
      const payload = (await response.json()) as {
        data?: { autonomy: Autonomy | null; effective: Autonomy; source: AutonomySource };
      };
      if (payload.data) {
        setOverride(payload.data.autonomy);
        setEffective(payload.data.effective);
        setSource(payload.data.source);
      }
    } catch {
      setOverride(previous.override);
      setEffective(previous.effective);
      setSource(previous.source);
    } finally {
      setSaving(false);
    }
  };

  const options: Array<{ value: Autonomy; label: string; icon: typeof ShieldCheckIcon }> = [
    { value: "copilot", label: "Copilot", icon: ShieldCheckIcon },
    { value: "autopilot", label: "Autopilot", icon: ZapIcon },
  ];

  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)}>
      <div
        role="radiogroup"
        aria-label="Autonomy for this thread"
        aria-busy={saving}
        className={cn(
          "flex items-center rounded-full border border-border bg-muted/40 p-0.5",
          !loaded && "opacity-60",
        )}
      >
        {options.map((option) => {
          const active = effective === option.value;
          const Icon = option.icon;
          return (
            <Tooltip key={option.value}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => void write(option.value)}
                    className={cn(
                      "flex h-6 items-center gap-1 rounded-full px-2 text-[10px] font-medium transition-colors",
                      active
                        ? option.value === "autopilot"
                          ? "bg-foreground text-background"
                          : "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3" aria-hidden />
                    <span className="hidden sm:inline">{option.label}</span>
                  </button>
                }
              />
              <TooltipContent side="top" className="max-w-56">
                {option.value === "autopilot"
                  ? `Replies and sends on its own on ${SOURCE_LABEL[source]}. Guardrails still force a draft.`
                  : `Drafts and asks for approval on ${SOURCE_LABEL[source]}.`}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {override ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Reset to inherited mode"
                onClick={() => void write(null)}
                className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Undo2Icon className="size-3" aria-hidden />
              </button>
            }
          />
          <TooltipContent side="top">
            Set just for this thread — reset to inherit from{" "}
            {source === "contact" ? "the mailbox" : "the contact and mailbox"}.
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="hidden text-[10px] text-muted-foreground lg:inline">
          from {SOURCE_LABEL[source]}
        </span>
      )}
    </div>
  );
}
