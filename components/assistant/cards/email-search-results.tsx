"use client";

import { ChevronRightIcon, MailIcon } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import { MailTable, mailRowFromRecord } from "./mail-table";
import { asNumber, asRecord } from "./shared";

/**
 * A compact mail table of `search_emails` results: one short row per message
 * (from, subject, type, date) that opens the message in the mail client. The
 * count header collapses the table for a very long result set.
 */
export function EmailSearchResults({ output }: { output: unknown }) {
  const [open, setOpen] = useState(true);
  const data = asRecord(output);
  const rawRows = Array.isArray(data?.messages) ? data.messages : [];

  if (rawRows.length === 0) {
    return (
      <Card size="sm" className="w-full">
        <p className="px-(--card-spacing) text-sm text-muted-foreground">
          No matching emails.
        </p>
      </Card>
    );
  }

  const rows = rawRows.map((raw) => mailRowFromRecord(asRecord(raw) ?? {}));
  const count = asNumber(data?.count) ?? rows.length;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="w-full"
      data-slot="email-search-results"
    >
      <Card size="sm" className="w-full gap-0 py-0">
        <CollapsibleTrigger
          className={cn(
            "group/results flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[12px] font-medium text-card-foreground transition-colors hover:bg-mail-row-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
          )}
          aria-label={
            open
              ? `Hide ${count} ${count === 1 ? "message" : "messages"}`
              : `Show ${count} ${count === 1 ? "message" : "messages"}`
          }
        >
          <MailIcon className="size-3.5 shrink-0 text-mail-muted" aria-hidden />
          <span>
            {count} {count === 1 ? "message" : "messages"}
          </span>
          <span className="ml-auto text-[11px] font-normal text-mail-muted">
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
      </Card>
    </Collapsible>
  );
}
