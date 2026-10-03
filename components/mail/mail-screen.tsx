"use client";

import * as React from "react";
import dynamic from "next/dynamic";

import { useMailStore, mailFilterKey } from "@/components/mail/mail-store";
import { selectMessages } from "@/lib/mail/filter";
import { useMailShortcuts } from "@/components/mail/use-mail-shortcuts";
import { useMailEvents } from "@/components/assistant/use-agent-events";
import { MailToolbar } from "@/components/mail/mail-toolbar";
import { MailList } from "@/components/mail/mail-list";
import { MailReader } from "@/components/mail/mail-reader";
import { MailUndoToast } from "@/components/mail/mail-undo-toast";
import { MailAssistant } from "@/components/assistant/mail-assistant";

/**
 * The composer renders a Dialog that stays closed until "Compose" is used, so
 * its form (and the Base UI dialog machinery) is split out of the route's
 * initial bundle and fetched on first open.
 */
const ComposeDialog = dynamic(
  () =>
    import("@/components/mail/compose-dialog").then(
      (module) => module.ComposeDialog,
    ),
  { ssr: false },
);

export function MailScreen({
  initialOpenId,
  prefetchExpected = false,
}: {
  initialOpenId?: string;
  /**
   * Set by the mail pages: the layout streams a server-side mailbox prefetch,
   * so hold the client load until it settles rather than hitting Gmail twice.
   */
  prefetchExpected?: boolean;
}) {
  const messages = useMailStore((state) => state.messages);
  const status = useMailStore((state) => state.status);
  const error = useMailStore((state) => state.error);
  const filter = useMailStore((state) => state.filter);
  const query = useMailStore((state) => state.query);
  const openId = useMailStore((state) => state.openId);
  const load = useMailStore((state) => state.load);
  const openById = useMailStore((state) => state.openById);
  const prefetchSettled = useMailStore((state) => state.prefetchSettled);
  const nextPage = useMailStore((state) => state.nextPage);
  const prevPage = useMailStore((state) => state.prevPage);
  const loadingMore = useMailStore((state) => state.loadingMore);
  // The pager for the on-screen destination. Stable reference from the store,
  // so the derived flags below don't churn.
  const pager = useMailStore((state) => state.pagers[mailFilterKey(state.filter)]);

  const [focusedId, setFocusedId] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Gmail-like: a page turn (or destination change) lands at the top of the new
  // rows rather than leaving the viewport parked at the footer you clicked.
  const pageIndex = pager?.index ?? 0;
  React.useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [pageIndex, filter, loadingMore]);

  React.useEffect(() => {
    // When a server prefetch is in flight, wait for it to settle: if it seeded
    // the store this is a no-op, and if it failed it falls back to the fetch.
    if (prefetchExpected && !prefetchSettled) return;
    void load();
  }, [prefetchExpected, prefetchSettled, load]);

  // New mail the background sync discovered refreshes the live mailbox without
  // a manual reload. Best-effort: no mirror activity simply means no event.
  //
  // The reconnect handler recovers a load that failed while the server was
  // down/restarting: the stream reopening is the first reliable signal that the
  // backend is back, and without it the list would sit on its error state until
  // a full reload. It only fires when the store is actually in error, so a
  // normal reconnect never triggers a redundant Gmail round trip.
  useMailEvents({
    onMail: () => {
      void load();
    },
    onConnect: () => {
      if (useMailStore.getState().status === "error") void load(true);
    },
  });

  // The list shows one page at a time; the store keeps the union. Scoping to
  // the current chunk's ids is what makes Previous/Next meaningful rather than
  // a growing pile of every page ever visited.
  const pageIds = React.useMemo(
    () => (pager ? (pager.chunks[pager.index] ?? []) : null),
    [pager],
  );
  const pageScope = React.useMemo(
    () => (pageIds ? new Set(pageIds) : null),
    [pageIds],
  );

  const visible = React.useMemo(
    () => selectMessages(messages, filter, query, pageScope),
    [messages, filter, query, pageScope],
  );

  const hasPrev = Boolean(pager && pager.index > 0);
  const hasNext = Boolean(
    pager &&
      (pager.index + 1 < pager.chunks.length || pager.nextToken),
  );
  // Gmail-style "1–50" range over the pages loaded so far.
  const range = React.useMemo(() => {
    if (!pager) return null;
    let start = 0;
    for (let i = 0; i < pager.index; i += 1) {
      start += pager.chunks[i]?.length ?? 0;
    }
    return { start: start + 1, end: start + (pager.chunks[pager.index]?.length ?? 0) };
  }, [pager]);

  // Optional deep link: wait for the initial page load to settle, then open the
  // target (fetching it directly if it isn't on the loaded page).
  const openedInitial = React.useRef(false);
  React.useEffect(() => {
    if (!initialOpenId || openedInitial.current || status !== "ready") return;
    openedInitial.current = true;
    void openById(initialOpenId);
  }, [initialOpenId, status, openById]);

  // The keyboard cursor must never point at a row the current view dropped.
  // Derived rather than cleared in an effect: when a row leaves the view the
  // effective cursor becomes null on the same render, with no extra pass.
  const effectiveFocusedId = React.useMemo(
    () =>
      focusedId && visible.some((message) => message.id === focusedId)
        ? focusedId
        : null,
    [focusedId, visible],
  );

  useMailShortcuts({
    messages: visible,
    focusedId: effectiveFocusedId,
    setFocusedId,
  });

  const open = openId
    ? messages.find((message) => message.id === openId)
    : undefined;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
      <div className="flex min-h-0 flex-1">
        {/* min-w-0 is load-bearing: without it this column refuses to shrink
            below the list's min-content width and the card clips its own
            right edge, toolbar actions included. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-mail-surface">
          {open ? (
            <MailReader message={open} />
          ) : (
            <>
              <MailToolbar visible={visible} />
              <div
                ref={listRef}
                className="scrollbar-none min-h-0 flex-1 overflow-y-auto"
              >
                <MailList
                  messages={visible}
                  loading={status !== "ready"}
                  error={error}
                  onRetry={() => void load(true)}
                  focusedId={effectiveFocusedId}
                  hasPrev={hasPrev}
                  hasNext={hasNext}
                  loadingMore={loadingMore}
                  range={range}
                  onPrev={prevPage}
                  onNext={() => void nextPage()}
                />
              </div>
            </>
          )}
        </div>

        <MailAssistant />
      </div>

      <ComposeDialog />
      <MailUndoToast />
    </div>
  );
}
