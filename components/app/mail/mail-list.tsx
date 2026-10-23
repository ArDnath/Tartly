"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, CircleAlert, Inbox } from "lucide-react";

import { openPaywall, usePaywallStore } from "@/components/app/paywall/paywall-store";
import { useMailStore } from "@/components/app/mail/mail-store";
import { authClient } from "@/lib/auth-client";
import { groupConversationsByDate } from "@/lib/mail/filter";
import { MailRow } from "@/components/app/mail/mail-row";
import {
  createMailRowMenuHandle,
  MailRowMenu,
} from "@/components/app/mail/mail-row-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GOOGLE_CONNECT_ADDITIONAL_PARAMS,
  GOOGLE_CONNECT_SCOPES,
  MAIL_RECONNECT_CALLBACK_PATH,
  MAIL_RECONNECT_ERROR_CALLBACK_PATH,
} from "@/lib/onboarding/constants";
import { MICROSOFT_MAIL_SCOPES } from "@/lib/outlook/scopes";
import type { MailConversation } from "@/lib/mail/types";

interface MailListProps {
  /** One entry per conversation, newest first. */
  conversations: MailConversation[];
  loading: boolean;
  /** Set when the last mailbox load failed; shown only when nothing loaded. */
  error: string | null;
  /**
   * The server's error code for that failure. `gmail_not_connected` swaps the
   * retry for a "Reconnect Google" action, since a retry cannot fix a dead
   * grant.
   */
  errorCode: string | null;
  onRetry: () => void;
  focusedThreadId: string | null;
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

/**
 * Shown under the list for a free account: the server only returns the five
 * newest conversations, so this explains the cap and opens the paywall.
 */
function FreeReadingFooter() {
  return (
    <div className="mx-3 my-4 flex flex-col items-center gap-2 rounded-xl border border-border bg-card px-4 py-5 text-center">
      <p className="text-[13px] font-medium text-mail-strong">
        Free plan shows your 5 newest emails
      </p>
      <p className="max-w-xs text-[12px] text-mail-muted">
        Subscribe to Tartly Professional to read, search and send without limits.
      </p>
      <Button
        type="button"
        size="sm"
        onClick={() => openPaywall("mail_view")}
        className="mt-1"
      >
        Unlock all mail
      </Button>
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
        No conversations match this view. Try a different folder or clear the
        active filters.
      </p>
    </div>
  );
}

/**
 * Shown when a mailbox load fails and there is nothing to display. A dead
 * provider grant surfaces as `gmail_not_connected` / `outlook_not_connected`;
 * retrying just replays the rejected token, so that case offers a fresh consent
 * instead.
 */
function ErrorState({
  message,
  errorCode,
  onRetry,
}: {
  message: string;
  errorCode: string | null;
  onRetry: () => void;
}) {
  const { data: session } = authClient.useSession();
  const [reconnecting, setReconnecting] = React.useState(false);

  const provider =
    errorCode === "gmail_not_connected"
      ? ("google" as const)
      : errorCode === "outlook_not_connected"
        ? ("microsoft" as const)
        : null;

  const handleReconnect = async () => {
    if (!provider) return;
    setReconnecting(true);
    try {
      const result =
        provider === "microsoft"
          ? await authClient.linkSocial({
              provider: "microsoft",
              scopes: [...MICROSOFT_MAIL_SCOPES],
              callbackURL: MAIL_RECONNECT_CALLBACK_PATH,
              errorCallbackURL: MAIL_RECONNECT_ERROR_CALLBACK_PATH,
              disableRedirect: true,
            })
          : await authClient.linkSocial({
              provider: "google",
              scopes: [...GOOGLE_CONNECT_SCOPES],
              callbackURL: MAIL_RECONNECT_CALLBACK_PATH,
              errorCallbackURL: MAIL_RECONNECT_ERROR_CALLBACK_PATH,
              // Top-level navigation, not a popup: keep it out of history.
              disableRedirect: true,
              // Pin consent to the signed-in account; dropping this lets Google
              // pick whichever account is active, which the link callback then
              // rejects.
              ...(session?.user?.email ? { loginHint: session.user.email } : {}),
              additionalParams: { ...GOOGLE_CONNECT_ADDITIONAL_PARAMS },
            });

      if (result.data?.url) {
        window.location.replace(result.data.url);
        return;
      }
      setReconnecting(false);
    } catch {
      setReconnecting(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-20 text-center">
      <CircleAlert className="size-8 text-mail-muted/60" aria-hidden />
      <p className="text-[15px] font-medium text-mail-strong">
        Couldn&apos;t load your mailbox
      </p>
      <p className="max-w-xs text-[13px] text-mail-muted">{message}</p>
      {provider ? (
        <Button
          type="button"
          size="sm"
          onClick={handleReconnect}
          disabled={reconnecting}
          className="mt-1 rounded-full px-4"
        >
          {reconnecting
            ? "Opening\u2026"
            : provider === "microsoft"
              ? "Reconnect Outlook"
              : "Reconnect Google"}
        </Button>
      ) : null}
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
  conversations,
  loading,
  error,
  errorCode,
  onRetry,
  focusedThreadId,
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
  const isSubscriber = usePaywallStore(
    (state) => state.entitlement?.isSubscriber ?? false,
  );
  const entitlementLoaded = usePaywallStore((state) =>
    Boolean(state.entitlement),
  );

  // A failed load must not masquerade as an endless spinner: surface it with a
  // retry, but only when there is nothing to show (a stale list beats a blank).
  if (error && !conversations.length) {
    return <ErrorState message={error} errorCode={errorCode} onRetry={onRetry} />;
  }
  if (loading) return <LoadingRows />;

  const paginated = hasPrev || hasNext;
  // A page turn swaps the current rows for skeletons sized to the page being
  // replaced, so Next reads as navigating to a new page rather than a stall.
  const skeletonCount = conversations.length || 8;

  return (
    <div className="flex flex-col">
      {loadingMore ? (
        <LoadingRows count={skeletonCount} />
      ) : conversations.length ? (
        groupConversationsByDate(conversations).map((group) => (
          <section key={group.label}>
            <h3 className="px-4 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-wider text-mail-muted/70">
              {group.label}
            </h3>
            <div className="flex flex-col gap-0.5">
              {group.conversations.map((conversation) => {
                const ids = conversation.messages.map((message) => message.id);
                const selected =
                  ids.length > 0 && ids.every((id) => selectedSet.has(id));
                return (
                  <MailRow
                    key={conversation.threadId}
                    conversation={conversation}
                    selected={selected}
                    focused={focusedThreadId === conversation.threadId}
                    menuHandle={menuHandle}
                  />
                );
              })}
            </div>
          </section>
        ))
      ) : (
        <EmptyState />
      )}
      {entitlementLoaded && !isSubscriber && conversations.length > 0 ? (
        <FreeReadingFooter />
      ) : null}
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
