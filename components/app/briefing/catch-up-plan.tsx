"use client";

import {
  ArrowRightIcon,
  CalendarClockIcon,
  HandshakeIcon,
  InboxIcon,
  MailIcon,
  SendIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  CatchUp,
  CatchUpOption,
  CatchUpOptionId,
} from "@/lib/briefing/catchup-types";
import { cn } from "@/lib/utils";
import { TartlyAgentLogo } from "@/components/shared/brand/tartly-logo";

const OPTION_ICON: Record<CatchUpOptionId, LucideIcon> = {
  "catch-up": SparklesIcon,
  "draft-replies": MailIcon,
  meetings: CalendarClockIcon,
  promises: HandshakeIcon,
  nudge: SendIcon,
  triage: InboxIcon,
};

/**
 * The agent's opening plan after a catch-up.
 *
 * It is not a canned menu: every row sends a real user turn into the
 * conversation, and the agent answers with its tools (search, commitments,
 * meeting briefs, drafts). Choice is the point — the popup gets you here, this
 * decides what the agent actually works on.
 */
export function CatchUpPlan({
  catchUp,
  onSelect,
  disabled = false,
}: {
  catchUp: CatchUp;
  onSelect: (option: CatchUpOption) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-6">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted/50">
          <TartlyAgentLogo className="size-8" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-[-0.01em] text-foreground">
            {catchUp.headline}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {catchUp.subhead} Pick what you want me to take on.
          </p>
        </div>
      </div>

      <Card className="gap-0 overflow-hidden py-0 shadow-none">
        <CardHeader className="border-b border-border/60 px-4 py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <SparklesIcon className="size-4 text-muted-foreground" aria-hidden />
            Catch-up plan
          </CardTitle>
          <CardDescription className="text-xs">
            I run each of these with real tools — nothing is sent without your
            approval.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-border/60 p-0">
          {catchUp.options.map((option) => {
            const Icon = OPTION_ICON[option.id];
            return (
              <button
                key={option.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(option)}
                className={cn(
                  "group flex items-center gap-3.5 px-4 py-3.5 text-left transition-colors",
                  "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
                  "disabled:pointer-events-none disabled:opacity-60",
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background">
                  <Icon className="size-4 text-foreground" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {option.label}
                    </span>
                    {typeof option.count === "number" ? (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground tabular-nums">
                        {option.count}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </span>
                <ArrowRightIcon
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </button>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
