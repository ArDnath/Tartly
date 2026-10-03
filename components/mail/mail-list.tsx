"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, CircleAlert, Inbox } from "lucide-react";

import { useMailStore } from "@/components/mail/mail-store";
import { groupByDate } from "@/lib/mail/filter";
import { MailRow } from "@/components/mail/mail-row";
import {
  createMailRowMenuHandle,
  MailRowMenu,
} from "@/components/mail/mail-row-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { MailMessage } from "@/lib/mail/types";

interface MailListProps {
  messages: MailMessage[];
  loading: boolean;
  /** Set when the last mailbox load failed; shown only when nothing loaded. */
  error: string | null;
  onRetry: () => void;
  focusedId: string | null;
  /** A page before the current one is loaded and reachable. */
  hasPrev: boolean;
  /** Another page exists after the current one. */
  hasNext: boolean;
  /** A next-page fetch is in flight. */
  loadingMore: boolean;
  /** Gmail-style "1–50" range for the page on screen, when paginated. */
  range: { start: number; end: number } | null;
  onPrev: () => void;
  onNext: () => void;
}

function LoadingRows({ count = 8 }: { count?: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: count }).map((_, index) => (
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

/**
 * Gmail-style page footer: the visible range on the left, Previous/Next on the
 * right. Paging is always an explicit click — never scroll-triggered — and going
 * back is instant from the in-session page cache.
 */
function PagerBar({
  range,
  hasPrev,
  hasNext,
  loading,
  onPrev,
  onNext,
}: {
  range: { start: number; end: number } | null;
  hasPrev: boolean;
  hasNext: boolean;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-10 mt-1 flex items-center justify-between border-t border-mail-line bg-mail-surface px-4 py-2">
      <span className="text-[12px] tabular-nums text-mail-muted">
        {range && range.end >= range.start
          ? `${range.start}\u2013${range.end}`
          : ""}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={!hasPrev || loading}
          onClick={onPrev}
          aria-label="Previous page"
        >
          <ChevronLeft aria-hidden />
          Previous
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!hasNext || loading}
          onClick={onNext}
          aria-label="Next page"
        >
          {loading ? "Loading\u2026" : "Next"}
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}

export function MailList({
  messages,
  loading,
  error,
  onRetry,
  focusedId,
  hasPrev,
  hasNext,
  loadingMore,
  range,
  onPrev,
  onNext,
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

  const paginated = hasPrev || hasNext;
  // A page turn swaps the current rows for skeletons sized to the page being
  // replaced, so Next reads as navigating to a new page rather than a stall.
  const skeletonCount = messages.length || 8;

  return (
    <div className="flex flex-col">
      {loadingMore ? (
        <LoadingRows count={skeletonCount} />
      ) : messages.length ? (
        groupByDate(messages).map((group) => (
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
        ))
      ) : (
        <EmptyState />
      )}
      {paginated ? (
        <PagerBar
          range={range}
          hasPrev={hasPrev}
          hasNext={hasNext}
          loading={loadingMore}
          onPrev={onPrev}
          onNext={onNext}
        />
      ) : null}
      <MailRowMenu handle={menuHandle} />
    </div>
  );
}
