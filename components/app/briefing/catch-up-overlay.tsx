"use client";

import {
  ArrowRightIcon,
  CalendarClockIcon,
  ClockIcon,
  HandshakeIcon,
  MailIcon,
  MoonIcon,
  SendIcon,
  SunIcon,
  SunriseIcon,
  SunsetIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  CatchUp,
  CatchUpDaypart,
  CatchUpPreviewItem,
} from "@/lib/briefing/catchup-types";
import { cn } from "@/lib/utils";
import { TartlyAgentLogo } from "@/components/shared/brand/tartly-logo";

const DAYPART_ICON: Record<CatchUpDaypart, LucideIcon> = {
  morning: SunriseIcon,
  afternoon: SunIcon,
  evening: SunsetIcon,
  night: MoonIcon,
};

const PREVIEW_ICON: Record<CatchUpPreviewItem["kind"], LucideIcon> = {
  reply: MailIcon,
  meeting: CalendarClockIcon,
  promise: HandshakeIcon,
  followup: SendIcon,
};

/**
 * The reload popup: a big, time-aware "here's what you walked away from" card.
 *
 * It is pure presentation — the gate owns visibility and the hand-off. The
 * primary button continues the catch-up in the agent surface: in place in the
 * mail sidebar when it is on screen, or the assistant page otherwise; the
 * secondary dismisses it for the rest of the day.
 */
export function CatchUpOverlay({
  catchUp,
  onCatchUp,
  onLater,
}: {
  catchUp: CatchUp;
  onCatchUp: () => void;
  onLater: () => void;
}) {
  const DaypartIcon = DAYPART_ICON[catchUp.daypart];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Backdrop click / Escape is the same intent as "Later".
        if (!open) onLater();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn(
          "bg-catchup-texture gap-0 overflow-hidden p-0 sm:max-w-xl",
          // Glassmorphism: a translucent, blurred sand panel. It falls back to
          // a more opaque one where `backdrop-filter` is unsupported.
          "bg-popover/70 backdrop-blur-2xl backdrop-saturate-150",
          "supports-[backdrop-filter]:bg-popover/45",
          "ring-1 ring-white/10",
          "shadow-[0_24px_80px_-28px_rgba(0,0,0,0.85),inset_0_1px_0_0_rgba(255,255,255,0.08)]",
        )}
      >
        <div className="flex flex-col gap-6 p-8">
          <div className="flex items-center justify-between gap-2">
            <TartlyAgentLogo className="size-10 shrink-0" />
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
                catchUp.lateLabel
                  ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
                  : "border-border text-muted-foreground",
              )}
            >
              {catchUp.lateLabel ? (
                <ClockIcon className="size-3.5" aria-hidden />
              ) : (
                <DaypartIcon className="size-3.5" aria-hidden />
              )}
              {catchUp.lateLabel ?? "Today"}
            </span>
          </div>

          <div className="space-y-2">
            <DialogTitle className="text-balance text-3xl font-semibold tracking-[-0.03em]">
              {catchUp.headline}
            </DialogTitle>
            <DialogDescription className="text-pretty text-base leading-relaxed">
              {catchUp.subhead}
            </DialogDescription>
          </div>

          {catchUp.preview.length > 0 ? (
            <ul className="flex flex-col divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10">
              {catchUp.preview.map((item, index) => {
                const Icon = PREVIEW_ICON[item.kind];
                return (
                  <li
                    key={`${item.kind}:${index}`}
                    className="flex items-center gap-3 bg-white/[0.03] px-3.5 py-2.5"
                  >
                    <Icon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {item.title}
                    </span>
                    {item.subtitle ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {item.subtitle}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {catchUp.overnight ? (
            <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                  <MoonIcon className="size-4 text-muted-foreground" aria-hidden />
                  Overnight
                </span>
                <span className="text-xs text-muted-foreground">
                  {catchUp.overnight.windowLabel}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-foreground">
                  {catchUp.overnight.totals.sent} sent
                </span>
                <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-muted-foreground">
                  {catchUp.overnight.totals.drafted} drafted
                </span>
                <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-muted-foreground">
                  {catchUp.overnight.totals.blocked} held
                </span>
              </div>
              {catchUp.overnight.sent.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {catchUp.overnight.sent.slice(0, 3).map((item) => (
                    <li
                      key={`sent:${item.threadId}`}
                      className="truncate text-xs text-muted-foreground"
                    >
                      Sent automatically · {item.reasonLabel}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            <Button
              size="lg"
              className="h-11 flex-1 rounded-full px-6 text-base"
              onClick={onCatchUp}
            >
              <TartlyAgentLogo className="size-5 shrink-0" />
              Catch me up
              <ArrowRightIcon className="size-4" aria-hidden />
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className="h-11 rounded-full px-5 text-muted-foreground"
              onClick={onLater}
            >
              Later
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
