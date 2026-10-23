"use client";

import { MailFrame } from "./mail-frame";
import { MailTable, mailRowFromRecord } from "./mail-table";
import { asNumber, asRecord, asString } from "./shared";

/**
 * A `get_thread` conversation as a compact table: the subject once at the top,
 * then one short row per message (from, date) that opens it in the mail client.
 * Squared and hairline-ruled to match the other transcript mail artifacts.
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
    <MailFrame>
      <div className="flex items-center gap-2 border-b border-mail-line px-3 py-2">
        <span className="size-1.5 shrink-0 bg-mail-muted/50" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-mail-strong">
          {subject}
        </span>
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.12em] text-mail-muted tabular-nums">
          {total} {total === 1 ? "message" : "messages"}
        </span>
      </div>

      <MailTable rows={rows} showSubject={false} showHeader={false} />

      {omitted > 0 ? (
        <p className="border-t border-mail-line px-3 py-1.5 text-[11px] text-mail-muted">
          {omitted} earlier {omitted === 1 ? "message" : "messages"} not shown
        </p>
      ) : null}
    </MailFrame>
  );
}
