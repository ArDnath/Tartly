"use client";

import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import { MailFrame } from "./mail-frame";
import { MailTable, mailRowFromRecord } from "./mail-table";
import { asNumber, asRecord } from "./shared";

/**
 * A compact mail table of `search_emails` results: one short row per message
 * (from, subject, type, date) that opens the message in the mail client. The
 * count header collapses the table for a very long result set.
 *
 * The frame is squared and hairline-ruled — a measured instrument panel rather
 * than a rounded card.
 */
export function EmailSearchResults({ output }: { output: unknown }) {
  const [open, setOpen] = useState(true);
  const data = asRecord(output);
  const rawRows = Array.isArray(data?.messages) ? data.messages : [];

  if (rawRows.length === 0) {
    return (
      <MailFrame>
        <p className="px-3 py-2 text-[12px] text-mail-muted">
          No matching emails.
        </p>
      </MailFrame>
    );
  }

  const rows = rawRows.map((raw) => mailRowFromRecord(asRecord(raw) ?? {}));
  const count = asNumber(data?.count) ?? rows.length;
  const countLabel = `${count} ${count === 1 ? "message" : "messages"}`;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="w-full"
      data-slot="email-search-results"
    >
      <MailFrame>
        <CollapsibleTrigger
          className={cn(
            "group/results flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-mail-row-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
          )}
          aria-label={open ? `Hide ${countLabel}` : `Show ${countLabel}`}
        >
          <span className="size-1.5 shrink-0 bg-mail-muted/50" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[10px] font-medium uppercase tracking-[0.16em] text-mail-muted">
            {countLabel}
          </span>
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.12em] text-mail-muted">
            {open ? "Hide" : "Show"}
          </span>
          <ChevronRightIcon
            className={cn(
              "size-3.5 shrink-0 text-mail-muted transition-transform duration-200",
              open && "rotate-90",
            )}
            aria-hidden
          />
        </CollapsibleTrigger>

        <CollapsibleContent
          className={cn(
            "overflow-hidden border-t border-mail-line ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none",
            "data-closed:animate-collapsible-up data-open:animate-collapsible-down",
          )}
        >
          <MailTable rows={rows} />
        </CollapsibleContent>
      </MailFrame>
    </Collapsible>
  );
}
