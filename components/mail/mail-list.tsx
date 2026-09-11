"use client";

import * as React from "react";
import { CircleAlert, Inbox } from "lucide-react";

import { useMailStore } from "@/components/mail/mail-store";
import { groupByDate } from "@/lib/mail/filter";
import { MailRow } from "@/components/mail/mail-row";
import {
  createMailRowMenuHandle,
  MailRowMenu,
} from "@/components/mail/mail-row-menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { MailMessage } from "@/lib/mail/types";

interface MailListProps {
  messages: MailMessage[];
  loading: boolean;
  /** Set when the last mailbox load failed; shown only when nothing loaded. */
  error: string | null;
  onRetry: () => void;
  focusedId: string | null;
}

function LoadingRows() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 8 }).map((_, index) => (
        <div
          key={index}
          className="flex h-10 items-center gap-3 border-b border-mail-line pl-4 pr-6"
        >
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className="h-3.5 w-[180px]" />
          <Skeleton className="h-3.5 flex-1" />
          <Skeleton className="h-3.5 w-14" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-20 text-center">
      <Inbox className="size-8 text-mail-muted/60" aria-hidden />
      <p className="text-[15px] font-medium text-mail-strong">
        Nothing here yet
      </p>
      <p className="max-w-xs text-[13px] text-mail-muted">
        No messages match this view. Try a different folder or clear the active
        filters.
      </p>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-20 text-center">
      <CircleAlert className="size-8 text-mail-muted/60" aria-hidden />
      <p className="text-[15px] font-medium text-mail-strong">
        Couldn&apos;t load your mailbox
      </p>
      <p className="max-w-xs text-[13px] text-mail-muted">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded-full border border-border px-4 py-1.5 text-[13px] font-medium text-mail-strong transition-colors hover:bg-mail-row-hover"
      >
        Try again
      </button>
    </div>
  );
}

export function MailList({
  messages,
  loading,
  error,
  onRetry,
  focusedId,
}: MailListProps) {
  const selectedIds = useMailStore((state) => state.selectedIds);
  // A Set keeps the per-row lookup O(1) — with a flat `includes` each row scan
  // was O(selected×rows) on every selection change.
  const selectedSet = React.useMemo(
    () => new Set(selectedIds),
    [selectedIds],
  );
  // One handle for the whole list — see MailRowMenu for why this can't be
  // per-row without reintroducing the two-menus-open / flash-to-origin bugs.
  const menuHandle = React.useMemo(() => createMailRowMenuHandle(), []);

  // A failed load must not masquerade as an endless spinner: surface it with a
  // retry, but only when there is nothing to show (a stale list beats a blank).
  if (error && !messages.length) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }
  if (loading) return <LoadingRows />;
  if (!messages.length) return <EmptyState />;

  return (
    <div className="flex flex-col">
      {groupByDate(messages).map((group) => (
        <section key={group.label}>
          <h3 className="px-4 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-wider text-mail-muted/70">
            {group.label}
          </h3>
          <div className="flex flex-col gap-0.5">
            {group.messages.map((message) => (
              <MailRow
                key={message.id}
                message={message}
                selected={selectedSet.has(message.id)}
                focused={focusedId === message.id}
                menuHandle={menuHandle}
              />
            ))}
          </div>
        </section>
      ))}
      <MailRowMenu handle={menuHandle} />
    </div>
  );
}
