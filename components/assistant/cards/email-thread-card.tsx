"use client";

import { MessagesSquareIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { AgentEmailRef } from "./email-ref";
import { asNumber, asRecord, asString } from "./shared";

/** Collapse a message body into a one-paragraph snippet for the preview row. */
function bodySnippet(body: string | undefined): string | undefined {
  if (!body) return undefined;
  const collapsed = body
    .split("\n")
    .map((line) => line.trim())
    // Drop the quoted-reply markers a thread's later messages carry.
    .filter((line) => line.length > 0 && !line.startsWith(">"))
    .join(" ")
    .trim();
  if (!collapsed) return undefined;
  return collapsed.length > 240 ? `${collapsed.slice(0, 240)}…` : collapsed;
}

/**
 * A typed rendering of a `get_thread` result: the conversation's subject, then
 * each message as a clickable preview that opens the mail in the main UI.
 */
export function EmailThreadCard({ output }: { output: unknown }) {
  const data = asRecord(output);
  if (!data) return null;

  const rows = Array.isArray(data.messages) ? data.messages : [];
  const subject = asString(data.subject) ?? "(no subject)";
  const total = asNumber(data.totalMessages) ?? rows.length;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <MessagesSquareIcon
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="min-w-0 truncate">{subject}</span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {total} {total === 1 ? "message" : "messages"} in this conversation
        </p>
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
                date: asString(row.date),
                subject,
                snippet: bodySnippet(asString(row.body)),
              }}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}
