"use client";

import { PaperclipIcon } from "lucide-react";
import { useMemo } from "react";

import { useMailStore } from "@/components/app/mail/mail-store";
import { MailTagBadge } from "@/components/app/mail/mail-tag-badge";
import { formatMailTime } from "@/lib/mail/format";
import type { MailTag } from "@/lib/mail/types";
import { cn } from "@/lib/utils";

import { useOpenMailMessage } from "./email-ref";
import { parseMailAddress } from "./shared";

/** One compact mail line: who it's from, its title, and when. */
export interface MailRowData {
  id?: string;
  from?: string;
  subject?: string;
  date?: string;
  unread?: boolean;
  hasAttachments?: boolean;
}

function senderName(from: string | undefined): string {
  const { name, email } = parseMailAddress(from);
  return name ?? email ?? "Unknown sender";
}

/**
 * The shared column template for the header and every row. It grows a "type"
 * column only when a category is actually known for a message, so a search that
 * returns no categorised mail stays a tidy two/three-column table.
 */
function columns(showSubject: boolean, showCategory: boolean): string {
  if (showSubject && showCategory)
    return "grid-cols-[0.5rem_minmax(0,0.9fr)_minmax(0,1.3fr)_4.75rem_auto]";
  if (showSubject) return "grid-cols-[0.5rem_minmax(0,1fr)_minmax(0,1.5fr)_auto]";
  if (showCategory) return "grid-cols-[0.5rem_minmax(0,1fr)_4.75rem_auto]";
  return "grid-cols-[0.5rem_minmax(0,1fr)_auto]";
}

function MailTableRow({
  row,
  showSubject,
  showCategory,
  category,
}: {
  row: MailRowData;
  showSubject: boolean;
  showCategory: boolean;
  category: MailTag | undefined;
}) {
  const openMessage = useOpenMailMessage();
  const interactive = Boolean(row.id);

  const content = (
    <>
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full bg-mail-unread",
          row.unread ? "opacity-100" : "opacity-0",
        )}
      />
      <span
        className={cn(
          "min-w-0 truncate text-[12px]",
          row.unread
            ? "font-semibold text-mail-strong"
            : "text-mail-strong/80",
        )}
      >
        {senderName(row.from)}
      </span>
      {showSubject ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "truncate text-[12px]",
              row.unread ? "font-medium text-mail-strong" : "text-mail-strong/70",
            )}
          >
            {row.subject || "(no subject)"}
          </span>
          {row.hasAttachments ? (
            <PaperclipIcon
              className="size-3 shrink-0 text-mail-muted"
              aria-hidden
            />
          ) : null}
        </span>
      ) : null}
      {showCategory ? (
        <span className="flex min-w-0">
          {category ? <MailTagBadge tag={category} /> : null}
        </span>
      ) : null}
      <span className="text-right text-[11px] whitespace-nowrap tabular-nums text-mail-muted">
        {row.date ? formatMailTime(row.date) : ""}
      </span>
    </>
  );

  const layout = cn(
    columns(showSubject, showCategory),
    "grid w-full items-center gap-x-3 px-3 py-1.5",
  );

  if (!interactive) {
    return <div className={layout}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => row.id && openMessage(row.id)}
      title="Open in Mail"
      className={cn(
        layout,
        "text-left transition-colors hover:bg-mail-row-hover focus-visible:bg-mail-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
      )}
    >
      {content}
    </button>
  );
}

/**
 * A compact mail table for the agent transcript: From, the subject line, an
 * optional type badge, and the date — one short row per message, hairline
 * divided, the whole row a link into the mail client. Bodies, snippets and
 * reply controls are deliberately absent.
 */
export function MailTable({
  rows,
  showSubject = true,
  showHeader = true,
  className,
}: {
  rows: MailRowData[];
  showSubject?: boolean;
  showHeader?: boolean;
  className?: string;
}) {
  const messages = useMailStore((state) => state.messages);
  const tagById = useMemo(() => {
    const map = new Map<string, MailTag>();
    for (const message of messages) map.set(message.id, message.tag);
    return map;
  }, [messages]);

  const showCategory = useMemo(
    () => rows.some((row) => (row.id ? tagById.has(row.id) : false)),
    [rows, tagById],
  );

  const grid = columns(showSubject, showCategory);

  return (
    <div className={cn("w-full", className)}>
      {showHeader ? (
        <div
          className={cn(
            "grid items-center gap-x-3 border-b border-mail-line px-3 py-1.5",
            grid,
          )}
        >
          <span aria-hidden />
          <span className="text-[10px] font-medium tracking-[0.12em] text-mail-muted uppercase">
            From
          </span>
          {showSubject ? (
            <span className="text-[10px] font-medium tracking-[0.12em] text-mail-muted uppercase">
              Subject
            </span>
          ) : null}
          {showCategory ? (
            <span className="text-[10px] font-medium tracking-[0.12em] text-mail-muted uppercase">
              Type
            </span>
          ) : null}
          <span className="text-right text-[10px] font-medium tracking-[0.12em] text-mail-muted uppercase">
            Date
          </span>
        </div>
      ) : null}

      <div className="divide-y divide-mail-line/60">
        {rows.map((row, index) => (
          <MailTableRow
            key={row.id ?? index}
            row={row}
            showSubject={showSubject}
            showCategory={showCategory}
            category={row.id ? tagById.get(row.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

/** Narrow a raw tool record into a table row, defensively. */
export function mailRowFromRecord(record: Record<string, unknown>): MailRowData {
  const attachments = Array.isArray(record.attachments)
    ? record.attachments
    : [];
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    from: typeof record.from === "string" ? record.from : undefined,
    subject: typeof record.subject === "string" ? record.subject : undefined,
    date: typeof record.date === "string" ? record.date : undefined,
    unread: record.unread === true,
    hasAttachments: attachments.length > 0,
  };
}
