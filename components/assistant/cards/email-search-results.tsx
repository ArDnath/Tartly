"use client";

import { ChevronRightIcon, MailIcon } from "lucide-react";
import { useState } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import { AgentEmailRef } from "./email-ref";
import { asBoolean, asNumber, asRecord, asString } from "./shared";

/**
 * A compact, typed rendering of `search_emails` results.
 *
 * A bulk search can return dozens of rows; dumping them all into the transcript
 * buries the rest of the conversation. The list is therefore collapsed by
 * default — the header names the count and opens on demand.
 */
export function EmailSearchResults({ output }: { output: unknown }) {
  const [open, setOpen] = useState(false);
  const data = asRecord(output);
  const rows = Array.isArray(data?.messages) ? data.messages : [];

  if (rows.length === 0) {
    return (
      <Card size="sm">
        <CardContent className="text-sm text-muted-foreground">
          No matching emails.
        </CardContent>
      </Card>
    );
  }

  const count = asNumber(data?.count) ?? rows.length;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="w-full"
      data-slot="email-search-results"
    >
      <Card size="sm">
        <CardHeader>
          <CollapsibleTrigger
            className="group/results flex w-full cursor-pointer items-center gap-2 text-left text-sm font-medium text-card-foreground"
            aria-label={
              open
                ? `Hide ${count} ${count === 1 ? "message" : "messages"}`
                : `Show ${count} ${count === 1 ? "message" : "messages"}`
            }
          >
            <MailIcon
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span>
              {count} {count === 1 ? "message" : "messages"}
            </span>
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {open ? "Hide" : "Show"}
            </span>
            <ChevronRightIcon
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                "group-data-panel-open/results:rotate-90",
              )}
              aria-hidden
            />
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent
          className={cn(
            "overflow-hidden ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none",
            "data-closed:animate-collapsible-up data-open:animate-collapsible-down",
          )}
        >
          <CardContent className="gap-2">
            {rows.map((raw, index) => {
              const row = asRecord(raw) ?? {};
              const id = asString(row.id);
              return (
                <AgentEmailRef
                  key={id ?? index}
                  email={{
                    ...(id ? { id } : {}),
                    from: asString(row.from),
                    subject: asString(row.subject),
                    snippet: asString(row.snippet),
                    date: asString(row.date),
                    unread: asBoolean(row.unread),
                    hasAttachments: asBoolean(row.hasAttachments),
                  }}
                />
              );
            })}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
