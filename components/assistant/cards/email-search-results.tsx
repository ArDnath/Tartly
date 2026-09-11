"use client";

import { MailIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { AgentEmailRef } from "./email-ref";
import { asBoolean, asNumber, asRecord, asString } from "./shared";

/** A compact, typed rendering of `search_emails` results. */
export function EmailSearchResults({ output }: { output: unknown }) {
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
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <MailIcon className="size-4 text-muted-foreground" aria-hidden />
          {count} {count === 1 ? "message" : "messages"}
        </CardTitle>
      </CardHeader>
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
    </Card>
  );
}
