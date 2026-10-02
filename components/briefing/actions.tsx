"use client";

import { CheckIcon, ClockIcon, Loader2Icon, PencilIcon, SendIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { ChatBriefingPart } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

/**
 * The one-tap action row under a briefing card. Every action is a single click
 * on an explicit intent: send is an approval, tomorrow snoozes, ignore stops.
 * State is local so the card settles in place instead of reloading the thread.
 */

type ActionState =
  | "idle"
  | "sending"
  | "sent"
  | "snoozing"
  | "snoozed"
  | "ignoring"
  | "ignored"
  | "error";

export function BriefingActions({
  part,
  onViewBrief,
}: {
  part: ChatBriefingPart;
  onViewBrief?: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>("idle");

  const request = async (url: string, body?: unknown): Promise<boolean> => {
    try {
      const response = await fetch(url, {
        method: "POST",
        ...(body
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  const send = async () => {
    if (!part.draftId) return;
    setState("sending");
    const ok = await request(`/api/v1/drafts/${part.draftId}/approve`, {});
    if (ok) {
      setState("sent");
      router.refresh();
    } else {
      setState("error");
    }
  };

  const edit = () => {
    if (part.threadId) router.push(`/inbox/${part.threadId}`);
  };

  const tomorrow = async () => {
    if (!part.enrollmentId) return;
    setState("snoozing");
    const ok = await request(`/api/v1/followups/${part.enrollmentId}/snooze`, {
      days: 1,
    });
    setState(ok ? "snoozed" : "error");
  };

  const ignore = async () => {
    if (!part.enrollmentId) return;
    setState("ignoring");
    const ok = await request(`/api/v1/followups/${part.enrollmentId}/stop`, {});
    setState(ok ? "ignored" : "error");
  };

  const done =
    state === "sent" || state === "snoozed" || state === "ignored";

  const busy = state === "sending" || state === "snoozing" || state === "ignoring";

  if (done) {
    const label =
      state === "sent"
        ? "Sent"
        : state === "snoozed"
          ? "Pushed to tomorrow"
          : "Ignored";
    return (
      <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <CheckIcon className="size-3.5" aria-hidden />
        {label}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {part.actions.includes("send") && part.draftId ? (
        <Button size="sm" onClick={send} disabled={busy} className="gap-1.5">
          {state === "sending" ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <SendIcon className="size-3.5" />
          )}
          Send
        </Button>
      ) : null}

      {part.actions.includes("edit") && part.threadId ? (
        <Button
          size="sm"
          variant="outline"
          onClick={edit}
          disabled={busy}
          className="gap-1.5"
        >
          <PencilIcon className="size-3.5" />
          Edit
        </Button>
      ) : null}

      {part.actions.includes("tomorrow") ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={tomorrow}
          disabled={busy}
          className="gap-1.5 text-muted-foreground"
        >
          {state === "snoozing" ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <ClockIcon className="size-3.5" />
          )}
          Tomorrow
        </Button>
      ) : null}

      {part.actions.includes("ignore") ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={ignore}
          disabled={busy}
          className="text-muted-foreground"
        >
          Ignore
        </Button>
      ) : null}

      {part.actions.includes("view_brief") ? (
        <Button size="sm" onClick={onViewBrief} className="gap-1.5">
          View brief
        </Button>
      ) : null}

      {state === "error" ? (
        <span className={cn("text-xs text-amber-600 dark:text-amber-400")}>
          Something went wrong. Try again.
        </span>
      ) : null}
    </div>
  );
}
