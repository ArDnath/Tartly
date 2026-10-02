"use client";

import { CalendarIcon } from "lucide-react";
import { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChatBriefingPart } from "@/lib/db/schema";

import { BriefingActions } from "./actions";
import { MeetingBriefSheet } from "./meeting-brief-sheet";
import { KindBadge, MetaLine } from "./primitives";

type Brief = NonNullable<ChatBriefingPart["brief"]>;

function formatWhen(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** An upcoming meeting with a one-click, cached brief. */
export function MeetingCard({ part }: { part: ChatBriefingPart }) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(part.brief ?? null);

  const openBrief = async () => {
    setOpen(true);
    if (!part.meetingId) return;
    try {
      // POST generates-or-serves; it is the explicit "prepare brief" action.
      const response = await fetch(
        `/api/v1/meetings/${part.meetingId}/brief`,
        { method: "POST" },
      );
      if (!response.ok) return;
      const payload = (await response.json()) as { data?: { brief?: Brief } };
      if (payload.data?.brief) setBrief(payload.data.brief);
    } catch {
      // The embedded brief (if any) stays on screen; nothing else to do.
    }
  };

  const when = formatWhen(part.subtitle);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <CalendarIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{part.title}</span>
          <KindBadge>Meeting</KindBadge>
        </CardTitle>
        {when ? <MetaLine>{when}</MetaLine> : null}
        {part.summary ? (
          <p className="text-[13px] leading-relaxed text-foreground/90">
            {part.summary}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="gap-2.5">
        <BriefingActions part={part} onViewBrief={openBrief} />
      </CardContent>
      <MeetingBriefSheet
        brief={brief}
        subject={part.title}
        open={open}
        onOpenChange={setOpen}
      />
    </Card>
  );
}
