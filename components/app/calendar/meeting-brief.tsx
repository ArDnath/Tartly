"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface MeetingBriefView {
  summary: string;
  attendees: string[];
  lastTouch: string | null;
  talkingPoints: string[];
  openItems: string[];
  source: "model" | "heuristic";
  generatedAt: string;
}

/**
 * "Prepare brief" for an upcoming meeting (Phase 4, C13). Generated on demand
 * and cached server-side by (meeting, attendees, day); opening it twice is free.
 */
export function MeetingBriefButton({
  meetingId,
  subject,
}: {
  meetingId: string;
  subject: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<MeetingBriefView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const prepare = async () => {
    setOpen(true);
    if (brief || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/meetings/${meetingId}/brief`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        data?: { brief: MeetingBriefView };
        error?: { message?: string };
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message || "Couldn't prepare a brief.");
      }
      setBrief(payload.data.brief);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't prepare a brief.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void prepare()}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <Sparkles className="size-3.5" aria-hidden />
        Prepare brief
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{subject?.trim() || "Meeting"} — brief</DialogTitle>
            <DialogDescription>
              Drawn from your email with these attendees.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Preparing…
            </div>
          ) : error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : brief ? (
            <div className="flex flex-col gap-4 text-[13px]">
              <p className="leading-relaxed text-foreground">{brief.summary}</p>

              {brief.attendees.length > 0 ? (
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Attendees
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    {brief.attendees.join(", ")}
                  </p>
                </div>
              ) : null}

              {brief.lastTouch ? (
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Last touch
                  </p>
                  <p className="mt-0.5 text-muted-foreground">{brief.lastTouch}</p>
                </div>
              ) : null}

              {brief.talkingPoints.length > 0 ? (
                <BriefList title="Talking points" items={brief.talkingPoints} />
              ) : null}
              {brief.openItems.length > 0 ? (
                <BriefList title="Open items" items={brief.openItems} />
              ) : null}

              <p className="text-[10px] text-muted-foreground">
                {brief.source === "model" ? "AI-prepared" : "Built from your email"} ·
                cached for today
              </p>
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function BriefList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <ul className="mt-1 list-disc pl-5 text-muted-foreground">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
