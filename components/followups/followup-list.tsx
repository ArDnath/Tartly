"use client";

import { Pause, Play, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { FollowupListItem } from "@/lib/followup/service";
import { cn } from "@/lib/utils";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FollowupList({ items }: { items: FollowupListItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  const act = async (id: string, action: "pause" | "resume" | "stop") => {
    setBusyId(id);
    try {
      const response =
        action === "stop"
          ? await fetch(`/api/v1/followups/${id}/stop`, { method: "POST" })
          : await fetch(`/api/v1/followups/${id}/pause`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paused: action === "pause" }),
            });
      if (!response.ok) {
        throw new Error(`Follow-up action failed (${response.status})`);
      }
      router.refresh();
    } catch (error) {
      console.error("[followups] action failed", error);
    } finally {
      setBusyId(null);
    }
  };

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No follow-ups yet. They start after your assistant replies.
      </p>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-4 border-b border-border py-3"
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm text-foreground">
              {item.subject ?? "(no subject)"}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {item.status} · attempt {item.attempts}/{item.maxAttempts} · next{" "}
              {formatDate(item.nextEvalAt)}
            </span>
          </div>

          <span
            className={cn(
              "shrink-0 text-[10px] uppercase tracking-wider",
              item.status === "active"
                ? "text-foreground/70"
                : "text-muted-foreground",
            )}
          >
            {item.status}
          </span>

          {item.status === "active" || item.status === "paused" ? (
            <div className="flex shrink-0 items-center gap-1">
              {item.status === "paused" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Resume"
                  disabled={busyId === item.id}
                  onClick={() => void act(item.id, "resume")}
                >
                  <Play className="size-3" />
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Pause"
                  disabled={busyId === item.id}
                  onClick={() => void act(item.id, "pause")}
                >
                  <Pause className="size-3" />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Stop"
                disabled={busyId === item.id}
                onClick={() => void act(item.id, "stop")}
              >
                <Square className="size-3" />
              </Button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
