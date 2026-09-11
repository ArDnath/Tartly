"use client";

import { CalendarClock, Loader2, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { MeetingProposal } from "@/lib/calendar/booking";

function formatRange(startAt: string | null, endAt: string | null): string {
  if (!startAt) return "";
  const start = new Date(startAt);
  const startLabel = start.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (!endAt) return startLabel;
  const endLabel = new Date(endAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${startLabel} – ${endLabel}`;
}

export function MeetingCard({
  threadId,
  proposal,
  meeting,
}: {
  threadId: string;
  proposal: MeetingProposal | null;
  meeting: {
    id: string;
    startAt: string | null;
    endAt: string | null;
    meetLink: string | null;
    status: string;
  } | null;
}) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);

  if (meeting) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <CalendarClock className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[12px] font-medium capitalize text-foreground">
            Meeting {meeting.status}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {formatRange(meeting.startAt, meeting.endAt)}
          </span>
        </div>
        {meeting.meetLink ? (
          <a
            href={meeting.meetLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Video className="size-3.5" />
            Join
          </a>
        ) : null}
      </div>
    );
  }

  if (!proposal || proposal.slots.length === 0) return null;

  const book = async (slotIndex: number) => {
    setIsBusy(true);
    try {
      const response = await fetch("/api/v1/meetings/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, slotIndex }),
      });
      if (response.ok) router.refresh();
    } catch (error) {
      console.error("[inbox] booking failed", error);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-4 py-3.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Proposed times
      </span>
      <div className="flex flex-wrap gap-1.5">
        {proposal.slots.map((slot, index) => (
          <Button
            key={slot.startUtc}
            type="button"
            variant="outline"
            size="xs"
            disabled={isBusy}
            onClick={() => void book(index)}
            className="gap-1"
          >
            {isBusy ? <Loader2 className="size-3 animate-spin" /> : null}
            {slot.label ??
              new Date(slot.startUtc).toLocaleString(undefined, {
                weekday: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
          </Button>
        ))}
      </div>
    </div>
  );
}
