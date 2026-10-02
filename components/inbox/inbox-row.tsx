import { memo } from "react";
import Link from "next/link";

import type { InboxItem } from "@/lib/inbox/service";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<string, string> = {
  needs_reply: "Needs reply",
  awaiting_reply: "Waiting",
  meeting_request: "Meeting",
  invoice: "Invoice",
  newsletter: "Newsletter",
  fyi: "FYI",
  spam: "Spam",
};

export function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Bare address from a `Name <addr>` value (or the value itself). */
function bareAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim();
}

/** Initials for the small round sender avatar (falls back to "@"). */
export function senderInitials(item: Pick<InboxItem, "from" | "fromName">): string {
  const source = item.fromName?.trim() || (item.from ? bareAddress(item.from) : "");
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "@";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function senderLabel(item: Pick<InboxItem, "from" | "fromName">): string {
  if (item.fromName) return item.fromName;
  if (!item.from) return "Unknown sender";
  const local = bareAddress(item.from).split("@")[0];
  return local || item.from;
}

/**
 * One thread in the inbox list. Slashy-style: calm, three-line row with a
 * sender avatar, an unread marker, a short snippet and a monochrome label.
 */
export const InboxRow = memo(function InboxRow({
  item,
  focused = false,
}: {
  item: InboxItem;
  focused?: boolean;
}) {
  const label = item.category ? CATEGORY_LABEL[item.category] ?? item.category : null;

  return (
    <Link
      href={`/inbox/${item.threadId}`}
      data-inbox-row
      data-focused={focused || undefined}
      className={cn(
        "group relative flex gap-3 border-b border-border px-5 py-3.5 transition-colors",
        focused ? "bg-accent" : "hover:bg-card",
      )}
    >
      {item.isUnread ? (
        <span
          aria-hidden
          className="absolute inset-y-3.5 left-1.5 w-0.5 rounded-full bg-foreground"
        />
      ) : null}

      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-medium",
          item.isUnread
            ? "bg-foreground text-background"
            : "bg-secondary text-muted-foreground",
        )}
      >
        {senderInitials(item)}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <span
            className={cn(
              "truncate text-[13px]",
              item.isUnread
                ? "font-semibold text-foreground"
                : "font-medium text-foreground/85",
            )}
          >
            {senderLabel(item)}
          </span>
          <span
            suppressHydrationWarning
            className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
          >
            {relativeTime(item.lastMessageAt)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px]",
              item.isUnread ? "text-foreground" : "text-foreground/80",
            )}
          >
            {item.subject ?? "(no subject)"}
          </span>
          {item.hasPendingDraft ? (
            <span className="shrink-0 rounded border border-border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-foreground/70">
              Draft
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[12px] leading-relaxed text-muted-foreground">
            {item.snippet ?? ""}
          </span>
          {item.isColdEmail ? (
            <span className="shrink-0 rounded border border-border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-foreground/70">
              Cold
            </span>
          ) : null}
          {label ? (
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
              {label}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
});
