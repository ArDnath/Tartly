"use client";

import { create } from "zustand";

import { openPaywall, usePaywallStore } from "@/components/app/paywall/paywall-store";
import { MAX_OUTBOUND_ASSETS } from "@/lib/assets/limits";
import * as mailApi from "@/lib/mail/client";
import { errorMessage, MailApiError } from "@/lib/mail/client";
import { conversationKey } from "@/lib/mail/conversations";
import { parseAddressList } from "@/lib/mail/format";
import {
  EMPTY_MAIL_QUERY,
  type InitialMailbox,
  type MailAccount,
  type MailAddress,
  type MailBox,
  type MailDraft,
  type MailFilter,
  type MailMessage,
  type MailQuery,
  type MailThread,
  type MailView,
} from "@/lib/mail/types";

/** Which connected account the top-level filter is scoped to. */
export type MailAccountFilter = "all" | "gmail" | "outlook";

/** One reversible batch, kept so the toast can put the messages back. */
interface MailUndo {
  label: string;
  snapshot: MailMessage[];
  /** Reverses the Gmail-side change when the user takes the undo. */
  revert?: () => Promise<unknown>;
}

/**
 * Which Gmail box backs each sidebar view.
 *
 * `reminders` and `scheduled` have no Gmail counterpart — snooze is local to
 * this session — so they read off the pages already loaded rather than asking
 * for a box that does not exist.
 */
const VIEW_BOX: Record<MailView, mailApi.MailboxBox | null> = {
  all: "inbox",
  starred: "starred",
  reminders: null,
  scheduled: null,
  drafts: "drafts",
  sent: "sent",
  done: "archive",
  trash: "trash",
  spam: "spam",
};

/**
 * Cache identity of a page: one per sidebar destination *and* account scope,
 * so switching between All/Gmail/Outlook never shows another scope's page.
 */
function keyFor(
  filter: MailFilter,
  account: MailAccountFilter = "all",
): string {
  const base = `${filter.kind}:${filter.value}`;
  // The all-accounts scope keeps the historical key, so existing prefetch and
  // tests do not need a second spelling of the same page.
  return account === "all" ? base : `${base}:${account}`;
}

/** Public alias so the list can ask whether the current view has a next page. */
export { keyFor as mailFilterKey };

/** What to ask the BFF for, or null when the view is local-only. */
function requestFor(
  filter: MailFilter,
  account: MailAccountFilter = "all",
): mailApi.MailboxRequest | null {
  if (filter.kind === "label") {
    // Quotes delimit the label name in Gmail search syntax, so a name
    // containing one would end the term early. Outlook maps the same query to
    // a category of that name.
    return {
      box: "active",
      search: `label:"${filter.value.replace(/"/g, "")}"`,
      ...(account !== "all" ? { account } : {}),
    };
  }
  const box = VIEW_BOX[filter.value];
  return box
    ? { box, ...(account !== "all" ? { account } : {}) }
    : null;
}

/**
 * Destinations with a fetch already in flight. The sidebar and the mail screen
 * can both ask for the same page on mount; this keeps that to one round trip.
 */
const loadInFlight = new Set<string>();

/**
 * Destinations with a *next-page* fetch in flight. Separate from `loadInFlight`
 * so a manual "load more" never collapses into, or blocks, a concurrent refresh.
 */
const loadMoreInFlight = new Set<string>();

/**
 * Conversations fetched ahead of a click — hovering an agent transcript mail row
 * warms its thread so opening it lands with no round trip. The reader consumes
 * an entry on open; a small cap keeps this from growing with the mailbox. Kept
 * out of the store because it must never trigger a render.
 */
const warmedThreads = new Map<string, MailThread>();
const WARMED_THREAD_LIMIT = 8;

/** Threads with a warm fetch already running, so hover storms coalesce. */
const warmThreadInFlight = new Set<string>();

/** Message ids being resolved to a thread for warming. */
const warmMessageInFlight = new Set<string>();

/**
 * Fold a freshly fetched page into the union the store keeps.
 *
 * The union exists because the sidebar counts every destination and mutations
 * touch rows outside the view on screen — both need messages the current page
 * does not carry. But a refetch has to be a resync rather than an append: a
 * message this destination used to hold and no longer does has moved or been
 * deleted in Gmail, so it is dropped unless another loaded page still lists it.
 */
function absorb(
  messages: MailMessage[],
  pages: Record<string, string[]>,
  key: string,
  page: MailMessage[],
): { messages: MailMessage[]; pages: Record<string, string[]> } {
  const previously = new Set(pages[key] ?? []);
  const current = new Set(page.map((message) => message.id));
  const heldElsewhere = new Set(
    Object.entries(pages)
      .filter(([other]) => other !== key)
      .flatMap(([, ids]) => ids),
  );
  const fresh = new Map(page.map((message) => [message.id, message]));

  const kept = messages
    .filter(
      (message) =>
        !previously.has(message.id) ||
        current.has(message.id) ||
        heldElsewhere.has(message.id),
    )
    .map((message) => fresh.get(message.id) ?? message);

  const known = new Set(kept.map((message) => message.id));
  return {
    messages: [...kept, ...page.filter((message) => !known.has(message.id))],
    pages: { ...pages, [key]: page.map((message) => message.id) },
  };
}

/**
 * Fold a *follow-on* cursor page into a destination that is already loaded.
 *
 * This is deliberately not `absorb`: `absorb` resyncs a page and drops rows the
 * refetch no longer lists, which is right for a refresh but wrong here — the
 * earlier pages are still valid, Gmail merely returned the next slice. New rows
 * append; rows already in the union (a message a label page also holds) are
 * refreshed in place rather than duplicated.
 */
function appendPage(
  messages: MailMessage[],
  pages: Record<string, string[]>,
  key: string,
  page: MailMessage[],
): { messages: MailMessage[]; pages: Record<string, string[]> } {
  const fresh = new Map(page.map((message) => [message.id, message]));
  const known = new Set(messages.map((message) => message.id));

  const refreshed = messages.map((message) => fresh.get(message.id) ?? message);
  const added = page.filter((message) => !known.has(message.id));

  const previous = pages[key] ?? [];
  const held = new Set(previous);
  const appended = page
    .map((message) => message.id)
    .filter((id) => !held.has(id));

  return {
    messages: [...refreshed, ...added],
    pages: { ...pages, [key]: [...previous, ...appended] },
  };
}

/**
 * Where a destination is in its Gmail page walk.
 *
 * `chunks` holds the id list of every page visited this session, so stepping
 * back and forward is instant and never refetches. `index` is the page on
 * screen; `nextToken` is Gmail's cursor for the page after the last loaded one.
 * Session-only: the cursor and the ids live in memory, never in a database.
 */
interface MailPager {
  chunks: string[][];
  index: number;
  nextToken?: string;
}

interface MailState {
  messages: MailMessage[];
  /** Message ids per destination already fetched — see `absorb`. */
  pages: Record<string, string[]>;
  /** Page walk per destination, keyed like `pages`. See `MailPager`. */
  pagers: Record<string, MailPager>;
  /** A next-page fetch is running for the view on screen. */
  loadingMore: boolean;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  /**
   * The server's error `code` for the last mailbox-load failure. Lets the list
   * tell a dead Google grant (`gmail_not_connected`) — which a retry cannot
   * fix — from a transient failure worth a "Try again".
   */
  errorCode: string | null;
  labels: string[];
  account: MailAddress | null;
  /** Every connected mail account, for the shared-inbox filter/badges. */
  accounts: MailAccount[];
  /** Top-level "All mail / Gmail / Outlook" scope. */
  accountFilter: MailAccountFilter;

  filter: MailFilter;
  query: MailQuery;
  searchOpen: boolean;
  selectedIds: string[];
  /** The conversation open in the reader, by Gmail thread id. */
  openThreadId: string | null;
  /** The full conversation fetched for the reader (`null` until it resolves). */
  thread: MailThread | null;
  threadStatus: "idle" | "loading" | "ready" | "error";
  composeOpen: boolean;
  composeInitial: Partial<MailDraft> | null;
  undo: MailUndo | null;

  load: (force?: boolean) => Promise<void>;
  /** Advance one page — cached if already visited, otherwise fetched. */
  nextPage: () => Promise<void>;
  /** Step back one page from the in-memory cache (never refetches). */
  prevPage: () => void;
  /** Seed the store from the server-prefetched default mailbox. */
  hydrate: (mailbox: InitialMailbox) => void;
  /** True once the server prefetch has resolved (with data or `null`). */
  prefetchSettled: boolean;
  /** Releases `MailScreen`'s deferred load after the prefetch resolves. */
  settlePrefetch: () => void;

  setFilter: (filter: MailFilter) => void;
  /** Scope every list read to all accounts, Gmail only, or Outlook only. */
  setAccountFilter: (account: MailAccountFilter) => void;
  setQuery: (patch: Partial<MailQuery>) => void;
  resetQuery: () => void;
  setSearchOpen: (open: boolean) => void;

  toggleSelected: (id: string) => void;
  /** Select/deselect every message of a conversation atomically. */
  toggleSelectedMany: (ids: string[]) => void;
  setSelected: (ids: string[]) => void;
  clearSelection: () => void;

  /** Open a conversation: fetch the whole thread and mark it read. */
  openConversation: (threadId: string) => Promise<void>;
  /** Deep-link opener: resolve a message id to its conversation and open it. */
  openById: (id: string) => Promise<void>;
  /**
   * Warm a conversation the pointer/focus is near, without opening it. Best
   * effort: the next `openConversation` for the same thread is instant.
   */
  prefetchThread: (threadId: string) => void;
  /** Warm a conversation from a message id when its thread id is not known. */
  prefetchMessage: (id: string) => void;
  closeConversation: () => void;

  toggleStar: (id: string) => void;
  /** Star (or unstar) every message of a conversation. */
  setStarred: (ids: string[], starred: boolean) => void;
  setRead: (ids: string[], read: boolean) => void;
  archive: (ids: string[]) => void;
  remove: (ids: string[]) => void;
  /** Permanently delete messages (bypassing the trash). Irreversible. */
  deleteForever: (ids: string[]) => void;
  /** Permanently delete everything in the trash. */
  emptyTrash: () => Promise<void>;
  restore: (ids: string[]) => void;
  snooze: (ids: string[], until: Date) => void;
  markSpam: (ids: string[], spam: boolean) => void;

  addLabel: (label: string) => void;
  applyLabel: (ids: string[], label: string) => void;

  send: (draft: MailDraft) => Promise<void>;
  saveDraft: (draft: MailDraft) => Promise<void>;

  openCompose: (initial?: Partial<MailDraft>) => void;
  closeCompose: () => void;

  undoLast: () => void;
  dismissUndo: () => void;
}

function addressesFrom(input: string): MailAddress[] {
  return parseAddressList(input).map((email) => ({
    name: email.split("@")[0] ?? email,
    email,
  }));
}

function toOutgoing(draft: MailDraft): mailApi.OutgoingMail {
  return {
    to: parseAddressList(draft.to),
    ...(draft.cc ? { cc: parseAddressList(draft.cc) } : {}),
    ...(draft.bcc ? { bcc: parseAddressList(draft.bcc) } : {}),
    subject: draft.subject,
    body: draft.body,
    ...(draft.assetIds?.length ? { assetIds: draft.assetIds } : {}),
    ...(draft.inlineImageIds?.length
      ? { inlineImageIds: draft.inlineImageIds }
      : {}),
    ...(draft.account ? { account: draft.account } : {}),
    ...(draft.threadId ? { threadId: draft.threadId } : {}),
  };
}

/**
 * Turn forwarded provider attachments into library asset ids just before a
 * send/save. A forward is only materialized when the user commits to it, so
 * opening and discarding the composer leaves no storage behind.
 */
async function materializeSourceAttachments(
  draft: MailDraft,
): Promise<MailDraft> {
  const source = draft.sourceAttachments ?? [];
  if (source.length === 0) return draft;

  const existing = draft.assetIds ?? [];
  const capacity = Math.max(
    0,
    MAX_OUTBOUND_ASSETS -
      existing.length -
      (draft.inlineImageIds?.length ?? 0),
  );
  if (capacity === 0) {
    throw new Error(
      `A message can carry at most ${MAX_OUTBOUND_ASSETS} files. Remove one before sending.`,
    );
  }

  const unique = new Map<string, (typeof source)[number]>();
  for (const attachment of source) {
    const key = `${attachment.messageId}:${attachment.attachmentId}`;
    if (!unique.has(key)) unique.set(key, attachment);
  }

  if (unique.size > capacity) {
    throw new Error(
      `This message would carry ${unique.size + existing.length + (draft.inlineImageIds?.length ?? 0)} files. The limit is ${MAX_OUTBOUND_ASSETS}; remove one before sending.`,
    );
  }

  const queue = [...unique.values()];
  const imported: string[] = [];
  // A forward can have a dozen files; bounded parallelism keeps latency down
  // without overflowing the asset rate limit.
  const workers = Array.from(
    { length: Math.min(3, queue.length) },
    async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        const asset = await mailApi.importMailAttachment(next);
        imported.push(asset.id);
      }
    },
  );
  await Promise.all(workers);

  const assetIds = [...new Set([...existing, ...imported])];
  return { ...draft, assetIds };
}

export const useMailStore = create<MailState>((set, get) => {
  /**
   * Gmail is authoritative, but waiting on a round trip before a row moves
   * makes the list feel broken. Every mutation applies locally first and then
   * confirms; if Gmail rejects it, the mailbox is reloaded so the UI snaps
   * back to the truth rather than silently diverging.
   */
  const confirm = (action: () => Promise<unknown>) => {
    void action().catch((error: unknown) => {
      set({ error: errorMessage(error, "Gmail rejected that change") });
      void get().load(true);
    });
  };

  /**
   * Every destructive batch goes through here: snapshot the touched rows,
   * apply the change, and leave an undo behind. Selection is cleared because
   * the rows have just left the current list.
   */
  const mutate = (
    ids: string[],
    label: string,
    change: (message: MailMessage) => MailMessage,
    apply: () => Promise<unknown>,
    revert?: () => Promise<unknown>,
  ) => {
    const target = new Set(ids);
    const { messages } = get();
    const snapshot = messages.filter((message) => target.has(message.id));
    if (!snapshot.length) return;

    // A batch that touches the open conversation closes the reader, matching
    // Gmail (archive a thread while reading it and you land back in the list).
    const closing = snapshot.some(
      (message) => conversationKey(message) === get().openThreadId,
    );

    set({
      messages: messages.map((message) =>
        target.has(message.id) ? change(message) : message,
      ),
      selectedIds: [],
      undo: { label, snapshot, ...(revert ? { revert } : {}) },
      ...(closing
        ? { openThreadId: null, thread: null, threadStatus: "idle" as const }
        : {}),
    });
    confirm(apply);
  };

  /** Non-destructive edits (star, read) need no undo entry. */
  const patch = (
    ids: string[],
    change: (message: MailMessage) => MailMessage,
  ) => {
    const target = new Set(ids);
    set((state) => ({
      messages: state.messages.map((message) =>
        target.has(message.id) ? change(message) : message,
      ),
    }));
  };

  /**
   * Forget cached pages so the next visit refetches them. Keys are matched by
   * prefix as well as exactly, because a destination now has one cache entry
   * per account scope (`view:sent:gmail`, `view:sent:outlook`, …).
   */
  const invalidate = (...keys: string[]) => {
    const matches = (key: string) =>
      keys.some((candidate) => key === candidate || key.startsWith(`${candidate}:`));
    set((state) => ({
      pages: Object.fromEntries(
        Object.entries(state.pages).filter(([key]) => !matches(key)),
      ),
      // Drop the page walk too: a refetched destination starts at page one.
      pagers: Object.fromEntries(
        Object.entries(state.pagers).filter(([key]) => !matches(key)),
      ),
    }));
  };

  /**
   * Apply a fetched conversation to the union and, when it is the thread on
   * screen, to the reader. Reading it clears its unread state on the fetched
   * copies so the reader and the list agree in the same frame.
   */
  const applyThread = (threadId: string, thread: MailThread) => {
    const unreadIds = thread.messages
      .filter((message) => message.unread)
      .map((message) => message.id);
    const messages = thread.messages.map((message) =>
      unreadIds.includes(message.id) ? { ...message, unread: false } : message,
    );
    const normalized: MailThread = { ...thread, messages };

    set((state) => {
      const byId = new Map(state.messages.map((m) => [m.id, m]));
      for (const message of messages) byId.set(message.id, message);
      return {
        messages: [...byId.values()],
        ...(state.openThreadId === threadId
          ? { thread: normalized, threadStatus: "ready" as const }
          : {}),
      };
    });

    if (unreadIds.length) confirm(() => mailApi.setRead(unreadIds, true));
  };

  /** Fetch a thread into the warm cache so a later open skips the network. */
  const warmThread = async (threadId: string) => {
    if (!threadId) return;
    if (get().openThreadId === threadId) return; // already on screen
    if (warmedThreads.has(threadId) || warmThreadInFlight.has(threadId)) return;
    warmThreadInFlight.add(threadId);
    try {
      const thread = await mailApi.fetchThread(threadId);
      warmedThreads.set(threadId, thread);
      if (warmedThreads.size > WARMED_THREAD_LIMIT) {
        const oldest = warmedThreads.keys().next().value;
        if (oldest !== undefined) warmedThreads.delete(oldest);
      }
    } catch {
      // Warming is an optimization; a failure here changes nothing.
    } finally {
      warmThreadInFlight.delete(threadId);
    }
  };

  /** Resolve a message id to its thread, then warm that thread. */
  const warmMessage = async (id: string) => {
    const known = get().messages.find((message) => message.id === id);
    if (known) return warmThread(conversationKey(known));
    if (warmMessageInFlight.has(id)) return;
    warmMessageInFlight.add(id);
    try {
      const full = await mailApi.fetchMessageBody(id);
      await warmThread(conversationKey(full));
    } catch {
      // See `warmThread` — best effort only.
    } finally {
      warmMessageInFlight.delete(id);
    }
  };

  return {
    messages: [],
    pages: {},
    pagers: {},
    loadingMore: false,
    status: "idle",
    error: null,
    errorCode: null,
    labels: [],
    account: null,
    accounts: [],
    accountFilter: "all",
    prefetchSettled: false,

    filter: { kind: "view", value: "all" },
    query: EMPTY_MAIL_QUERY,
    searchOpen: false,
    selectedIds: [],
    openThreadId: null,
    thread: null,
    threadStatus: "idle",
    composeOpen: false,
    composeInitial: null,
    undo: null,

    /** Fetch the destination currently on screen, unless it is already held. */
    load: async (force = false) => {
      const filter = get().filter;
      const account = get().accountFilter;
      const key = keyFor(filter, account);
      const request = requestFor(filter, account);

      // Local-only views have nothing to fetch; they read off the union.
      if (!request || (!force && key in get().pages)) {
        if (get().status !== "ready") set({ status: "ready", error: null, errorCode: null });
        return;
      }

      if (loadInFlight.has(key)) return;
      loadInFlight.add(key);

      set({ status: "loading", error: null, errorCode: null });
      try {
        const {
          messages,
          labels,
          account: accountProfile,
          accounts: accountList = [],
          nextPageToken,
        } = await mailApi.fetchMailbox(request);
        // The user may have moved on while this was in flight. The page is
        // still worth keeping, but it must not clear the spinner belonging to
        // whichever view they are now looking at.
        const stillShowing =
          keyFor(get().filter, get().accountFilter) === key;
        set((state) => ({
          ...absorb(state.messages, state.pages, key, messages),
          // A refresh restarts the walk at page one, so its cursor becomes the
          // only cursor and any deeper pages the destination had are dropped.
          pagers: {
            ...state.pagers,
            [key]: {
              chunks: [messages.map((message) => message.id)],
              index: 0,
              ...(nextPageToken ? { nextToken: nextPageToken } : {}),
            },
          },
          labels,
          account: accountProfile,
          accounts: accountList.length ? accountList : state.accounts,
          ...(stillShowing ? { status: "ready" as const } : {}),
        }));
      } catch (error) {
        set({
          status: "error",
          error: errorMessage(error, "Couldn't load your mailbox"),
          errorCode: error instanceof MailApiError ? error.code : null,
        });
      } finally {
        loadInFlight.delete(key);
      }
    },

    /**
     * Advance one page. Going forward into already-visited territory is a pure
     * index move; only the first step past the loaded frontier hits Gmail, one
     * page (one request) per click. Nothing here runs on scroll or in the
     * background, and only the returned page is held in memory.
     */
    nextPage: async () => {
      const filter = get().filter;
      const account = get().accountFilter;
      const key = keyFor(filter, account);
      const request = requestFor(filter, account);
      const pager = get().pagers[key];

      if (!request || !pager || loadMoreInFlight.has(key)) return;

      // Already fetched earlier this session — just move the cursor.
      if (pager.index + 1 < pager.chunks.length) {
        set((state) => ({
          pagers: {
            ...state.pagers,
            [key]: { ...pager, index: pager.index + 1 },
          },
        }));
        return;
      }

      const token = pager.nextToken;
      if (!token || loadInFlight.has(key)) return;
      loadMoreInFlight.add(key);

      set({ loadingMore: true, error: null });
      try {
        const page = await mailApi.fetchMailboxPage({
          ...request,
          pageToken: token,
        });
        const ids = page.messages.map((message) => message.id);
        set((state) => {
          const current = state.pagers[key] ?? pager;
          return {
            ...appendPage(state.messages, state.pages, key, page.messages),
            pagers: {
              ...state.pagers,
              [key]: {
                chunks: [...current.chunks, ids],
                index: current.index + 1,
                ...(page.nextPageToken
                  ? { nextToken: page.nextPageToken }
                  : {}),
              },
            },
            labels: page.labels,
          };
        });
      } catch (error) {
        set({
          error: errorMessage(error, "Couldn't load more mail"),
          errorCode: error instanceof MailApiError ? error.code : null,
        });
      } finally {
        loadMoreInFlight.delete(key);
        set({ loadingMore: false });
      }
    },

    /** Step back one page from the cache. No network, no spinner. */
    prevPage: () => {
      const key = keyFor(get().filter, get().accountFilter);
      const pager = get().pagers[key];
      if (!pager || pager.index === 0) return;
      set((state) => ({
        pagers: {
          ...state.pagers,
          [key]: { ...pager, index: pager.index - 1 },
        },
      }));
    },

    /**
     * Adopt the server-prefetched default page. Only seeds a store that has not
     * loaded anything yet, so a soft navigation back to `/mail` never discards
     * in-session state (read/unread, selection, an open reader).
     */
    hydrate: (mailbox) => {
      if (get().status !== "idle" || Object.keys(get().pages).length > 0) {
        return;
      }
      const key = keyFor({ kind: "view", value: "all" }, "all");
      set({
        messages: mailbox.messages,
        labels: mailbox.labels,
        account: mailbox.account,
        accounts: mailbox.accounts ?? [],
        accountFilter: "all",
        pages: { [key]: mailbox.messages.map((message) => message.id) },
        // A one-page walk, carrying the prefetch's cursor so Next works before
        // any refresh.
        pagers: {
          [key]: {
            chunks: [mailbox.messages.map((message) => message.id)],
            index: 0,
            ...(mailbox.nextPageToken
              ? { nextToken: mailbox.nextPageToken }
              : {}),
          },
        },
        status: "ready",
        error: null,
      });
    },

    settlePrefetch: () => set({ prefetchSettled: true }),

    setFilter: (filter) => {
      set({
        filter,
        selectedIds: [],
        openThreadId: null,
        thread: null,
        threadStatus: "idle",
        undo: null,
      });
      void get().load();
    },
    setAccountFilter: (accountFilter) => {
      set({
        accountFilter,
        selectedIds: [],
        openThreadId: null,
        thread: null,
        threadStatus: "idle",
        undo: null,
      });
      void get().load();
    },
    setQuery: (patchQuery) =>
      set((state) => ({ query: { ...state.query, ...patchQuery } })),
    resetQuery: () => set({ query: EMPTY_MAIL_QUERY }),
    setSearchOpen: (open) =>
      set((state) => ({
        searchOpen: open,
        query: open ? state.query : { ...state.query, search: "" },
      })),

    toggleSelected: (id) =>
      set((state) => ({
        selectedIds: state.selectedIds.includes(id)
          ? state.selectedIds.filter((selected) => selected !== id)
          : [...state.selectedIds, id],
      })),
    toggleSelectedMany: (ids) =>
      set((state) => {
        const selected = new Set(state.selectedIds);
        const allSelected =
          ids.length > 0 && ids.every((id) => selected.has(id));
        for (const id of ids) {
          if (allSelected) selected.delete(id);
          else selected.add(id);
        }
        return { selectedIds: [...selected] };
      }),
    setSelected: (ids) => set({ selectedIds: ids }),
    clearSelection: () => set({ selectedIds: [] }),

    /**
     * Opens a conversation. The list is metadata-only, so this pulls the whole
     * thread (every message, full bodies) and merges it into the union so
     * mutations and the sidebar can see all of it. Opening marks the
     * conversation read, exactly as Gmail does.
     */
    openConversation: async (threadId) => {
      if (get().openThreadId === threadId && get().threadStatus === "ready") {
        return;
      }
      set({
        openThreadId: threadId,
        selectedIds: [],
        thread: null,
        threadStatus: "loading",
      });

      // A hover-warmed thread skips the round trip entirely; the reader paints
      // on the click. Consume it so a stale copy is never reused.
      const warmed = warmedThreads.get(threadId);
      if (warmed) warmedThreads.delete(threadId);

      try {
        const thread = warmed ?? (await mailApi.fetchThread(threadId));
        // The user may have closed the reader or opened a different thread
        // while a fetch was in flight: `applyThread` still caches the messages
        // but never lets a stale fetch hijack the screen.
        applyThread(threadId, thread);
      } catch (error) {
        // A paywall block is not an error state: surface the wall and leave the
        // reader closed, rather than a red "couldn't open" banner behind it.
        if (mailApi.isPaymentRequired(error)) {
          openPaywall("mail_view");
          void usePaywallStore.getState().refresh();
          set({ openThreadId: null, thread: null, threadStatus: "idle" });
          return;
        }
        if (get().openThreadId === threadId) {
          set({
            threadStatus: "error",
            error: errorMessage(error, "Couldn't open that conversation"),
          });
        }
      }
    },
    closeConversation: () =>
      set({ openThreadId: null, thread: null, threadStatus: "idle" }),

    /**
     * Deep-link opener for `/mail/[id]`. The id is a Gmail message id in every
     * link we emit, but a bare thread id is accepted too — so a message id is
     * resolved to its conversation, and anything else is tried as a thread.
     */
    openById: async (id) => {
      const known = get().messages.find((message) => message.id === id);
      if (known) {
        await get().openConversation(conversationKey(known));
        return;
      }
      try {
        const full = await mailApi.fetchMessageBody(id);
        set((state) => ({
          messages: state.messages.some((message) => message.id === id)
            ? state.messages
            : [...state.messages, full],
        }));
        await get().openConversation(conversationKey(full));
      } catch (error) {
        if (mailApi.isPaymentRequired(error)) {
          openPaywall("mail_view");
          void usePaywallStore.getState().refresh();
          return;
        }
        // Not a message id — fall back to treating it as a thread id.
        await get().openConversation(id);
      }
    },

    prefetchThread: (threadId) => {
      void warmThread(threadId);
    },

    prefetchMessage: (id) => {
      void warmMessage(id);
    },

    toggleStar: (id) => {
      const starred = !get().messages.find((m) => m.id === id)?.starred;
      patch([id], (message) => ({ ...message, starred }));
      confirm(() => mailApi.setStarred([id], starred));
    },

    setStarred: (ids, starred) => {
      if (!ids.length) return;
      patch(ids, (message) => ({ ...message, starred }));
      confirm(() => mailApi.setStarred(ids, starred));
    },

    setRead: (ids, read) => {
      patch(ids, (message) => ({ ...message, unread: !read }));
      confirm(() => mailApi.setRead(ids, read));
    },

    archive: (ids) =>
      mutate(
        ids,
        ids.length > 1
          ? `${ids.length} conversations archived`
          : "Conversation archived",
        (message) => ({ ...message, box: "archive" as MailBox }),
        () => mailApi.setArchived(ids, true),
        () => mailApi.setArchived(ids, false),
      ),

    remove: (ids) =>
      mutate(
        ids,
        ids.length > 1
          ? `${ids.length} conversations deleted`
          : "Conversation moved to Trash",
        (message) => ({ ...message, box: "trash" as MailBox }),
        () => mailApi.setTrashed(ids, true),
        () => mailApi.setTrashed(ids, false),
      ),

    /**
     * Permanent deletion, bypassing the trash. Irreversible: the rows leave the
     * union for good and no Undo is offered (there is nothing to put back).
     */
    deleteForever: (ids) => {
      const target = new Set(ids);
      const { messages } = get();
      const snapshot = messages.filter((message) => target.has(message.id));
      if (!snapshot.length) return;
      const closing = snapshot.some(
        (message) => conversationKey(message) === get().openThreadId,
      );
      set({
        messages: messages.filter((message) => !target.has(message.id)),
        selectedIds: [],
        undo: {
          label:
            ids.length > 1
              ? `${ids.length} conversations deleted forever`
              : "Conversation deleted forever",
          // An empty snapshot is what tells the toast there is no Undo.
          snapshot: [],
        },
        ...(closing
          ? { openThreadId: null, thread: null, threadStatus: "idle" as const }
          : {}),
      });
      confirm(() => mailApi.deleteMessages(ids));
    },

    /** Permanently delete every trashed message, then drop the trash cache. */
    emptyTrash: async () => {
      const { messages } = get();
      const closing = messages.some(
        (message) =>
          message.box === "trash" &&
          conversationKey(message) === get().openThreadId,
      );
      set({
        messages: messages.filter((message) => message.box !== "trash"),
        selectedIds: [],
        undo: { label: "Trash emptied", snapshot: [] },
        ...(closing
          ? { openThreadId: null, thread: null, threadStatus: "idle" as const }
          : {}),
      });
      try {
        await mailApi.emptyTrash();
        invalidate("view:trash");
      } catch (error) {
        set({ error: errorMessage(error, "Couldn't empty the trash") });
        void get().load(true);
      }
    },

    restore: (ids) =>
      mutate(
        ids,
        "Moved to Inbox",
        (message) => ({
          ...message,
          box: "inbox" as MailBox,
          reminderAt: null,
        }),
        // Restoring covers both "out of trash" and "out of archive"; untrash
        // is a no-op on a message that was only archived.
        async () => {
          await mailApi.setTrashed(ids, false);
          await mailApi.setArchived(ids, false);
        },
      ),

    /**
     * Snooze has no Gmail API equivalent — `reminderAt` stays local to this
     * session and does not survive a reload or show up in Gmail proper.
     */
    snooze: (ids, until) =>
      mutate(
        ids,
        `Snoozed until ${until.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`,
        (message) => ({
          ...message,
          box: "inbox" as MailBox,
          reminderAt: until.toISOString(),
        }),
        async () => undefined,
      ),

    markSpam: (ids, spam) =>
      mutate(
        ids,
        spam ? "Reported as spam" : "Moved out of Spam",
        (message) => ({
          ...message,
          box: (spam ? "spam" : "inbox") as MailBox,
        }),
        () => mailApi.setSpam(ids, spam),
        () => mailApi.setSpam(ids, !spam),
      ),

    addLabel: (label) => {
      if (get().labels.includes(label)) return;
      set((state) => ({ labels: [...state.labels, label] }));
      confirm(() => mailApi.createLabel(label));
    },

    applyLabel: (ids, label) => {
      if (!get().labels.includes(label)) {
        set((state) => ({ labels: [...state.labels, label] }));
      }
      patch(ids, (message) =>
        message.labels.includes(label)
          ? message
          : { ...message, labels: [...message.labels, label] },
      );
      set({ selectedIds: [] });
      confirm(() => mailApi.applyLabel(ids, label));
    },

    /**
     * Sends through Gmail, then reloads so the message appears with the id and
     * threading Gmail assigned it rather than a locally invented row.
     */
    send: async (draft) => {
      // Fail fast when the free send allowance is already spent: keep the
      // composer open behind the paywall so the draft is not lost.
      const entitlement = usePaywallStore.getState().entitlement;
      if (
        entitlement &&
        !entitlement.isSubscriber &&
        entitlement.free.mailSendsRemaining <= 0
      ) {
        openPaywall("mail_send");
        return;
      }

      // Close immediately so a second click cannot send twice. Any failure
      // reopens the composer from the same draft.
      set({ composeOpen: false, composeInitial: null });
      try {
        const outgoing = await materializeSourceAttachments(draft);
        await mailApi.sendMail(toOutgoing(outgoing));
        set({ undo: { label: "Message sent", snapshot: [] } });
        // Sent now holds one more message than the cached page does; drop it so
        // opening Sent fetches rather than showing a stale list.
        invalidate("view:sent", "view:drafts");
        void usePaywallStore.getState().refresh();
        await get().load(true);
      } catch (error) {
        if (mailApi.isPaymentRequired(error)) {
          openPaywall("mail_send");
          void usePaywallStore.getState().refresh();
          set({ composeOpen: true, composeInitial: draft });
          return;
        }
        set({
          error: errorMessage(error, "Couldn't send that message"),
          composeOpen: true,
          composeInitial: draft,
        });
      }
    },

    saveDraft: async (draft) => {
      // Drafts route to the account the composer is replying from, so an
      // Outlook reply is filed in Outlook (Graph), never in Gmail.
      set({ composeOpen: false, composeInitial: null });
      try {
        const outgoing = await materializeSourceAttachments(draft);
        await mailApi.saveDraft(toOutgoing(outgoing));
        set({ undo: { label: "Draft saved", snapshot: [] } });
        invalidate("view:drafts");
        await get().load(true);
      } catch (error) {
        set({
          error: errorMessage(error, "Couldn't save that draft"),
          composeOpen: true,
          composeInitial: draft,
        });
      }
    },

    openCompose: (initial) =>
      set((state) => {
        const draft = initial ?? {};
        if (draft.account || draft.threadId) {
          return { composeOpen: true, composeInitial: draft };
        }
        const live = state.accounts.filter(
          (account) => account.connected && account.mailboxAccess,
        );
        const hasGmail = live.some((account) => account.provider === "gmail");
        const hasOutlook = live.some(
          (account) => account.provider === "outlook",
        );
        return {
          composeOpen: true,
          composeInitial: {
            ...draft,
            ...(hasGmail || !hasOutlook
              ? { account: "gmail" as const }
              : { account: "outlook" as const }),
          },
        };
      }),
    closeCompose: () => set({ composeOpen: false, composeInitial: null }),

    undoLast: () => {
      const { undo, messages } = get();
      if (!undo?.snapshot.length) return set({ undo: null });
      const restored = new Map(undo.snapshot.map((m) => [m.id, m]));
      set({
        messages: messages.map(
          (message) => restored.get(message.id) ?? message,
        ),
        undo: null,
      });
      if (undo.revert) confirm(undo.revert);
    },

    dismissUndo: () => set({ undo: null }),
  };
});

export { addressesFrom };
