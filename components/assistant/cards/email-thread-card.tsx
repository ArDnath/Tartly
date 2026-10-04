"use client";

import { MessagesSquareIcon } from "lucide-react";

import { Card } from "@/components/ui/card";

import { MailTable, mailRowFromRecord } from "./mail-table";
import { asNumber, asRecord, asString } from "./shared";

/**
 * A `get_thread` conversation as a compact table: the subject once at the top,
 * then one short row per message (from, date) that opens it in the mail client.
 */
export function EmailThreadCard({ output }: { output: unknown }) {
  const data = asRecord(output);
  if (!data) return null;

  const rawRows = Array.isArray(data.messages) ? data.messages : [];
  const rows = rawRows.map((raw) => mailRowFromRecord(asRecord(raw) ?? {}));
  const subject = asString(data.subject) ?? "(no subject)";
  const total = asNumber(data.totalMessages) ?? rows.length;
  const omitted = asNumber(data.olderMessagesOmitted) ?? 0;

  return (
    <Card size="sm" className="w-full gap-0 py-0">
      <div className="flex items-center gap-2 border-b border-mail-line px-3 py-2">
        <MessagesSquareIcon
          className="size-3.5 shrink-0 text-mail-muted"
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-card-foreground">
          {subject}
        </span>
        <span className="shrink-0 text-[11px] text-mail-muted">
          {total} {total === 1 ? "message" : "messages"}
        </span>
      </div>

      <MailTable rows={rows} showSubject={false} showHeader={false} />

      {omitted > 0 ? (
        <p className="border-t border-mail-line px-3 py-1.5 text-[11px] text-mail-muted">
          {omitted} earlier {omitted === 1 ? "message" : "messages"} not shown
        </p>
      ) : null}
    </Card>
  );
}
