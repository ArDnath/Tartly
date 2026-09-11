"use client";

import { create } from "zustand";

import * as mailApi from "@/lib/mail/client";
import { errorMessage } from "@/lib/mail/client";
import { parseAddressList } from "@/lib/mail/format";
import {
  EMPTY_MAIL_QUERY,
  type InitialMailbox,
  type MailAddress,
  type MailBox,
  type MailDraft,
  type MailFilter,
  type MailMessage,
  type MailQuery,
  type MailView,
} from "@/lib/mail/types";

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

/** Cache identity of a page: one per sidebar destination. */
function keyFor(filter: MailFilter): string {
  return `${filter.kind}:${filter.value}`;
}

/** What to ask the BFF for, or null when the view is local-only. */
function requestFor(filter: MailFilter): mailApi.MailboxRequest | null {
  if (filter.kind === "label") {
    // Quotes delimit the label name in Gmail search syntax, so a name
    // containing one would end the term early.
    return {
      box: "active",
      search: `label:"${filter.value.replace(/"/g, "")}"`,
    };
  }
  const box = VIEW_BOX[filter.value];
  return box ? { box } : null;
}

/**
 * Destinations with a fetch already in flight. The sidebar and the mail screen
 * can both ask for the same page on mount; this keeps that to one round trip.
 */
const loadInFlight = new Set<string>();

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

interface MailState {
  messages: MailMessage[];
  /** Message ids per destination already fetched — see `absorb`. */
  pages: Record<string, string[]>;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  labels: string[];
  account: MailAddress | null;

  filter: MailFilter;
  query: MailQuery;
  searchOpen: boolean;
  selectedIds: string[];
  openId: string | null;
  composeOpen: boolean;
  composeInitial: Partial<MailDraft> | null;
  undo: MailUndo | null;

  load: (force?: boolean) => Promise<void>;
  /** Seed the store from the server-prefetched default mailbox. */
  hydrate: (mailbox: InitialMailbox) => void;
  /** True once the server prefetch has resolved (with data or `null`). */
  prefetchSettled: boolean;
  /** Releases `MailScreen`'s deferred load after the prefetch resolves. */
  settlePrefetch: () => void;

  setFilter: (filter: MailFilter) => void;
  setQuery: (patch: Partial<MailQuery>) => void;
  resetQuery: () => void;
  setSearchOpen: (open: boolean) => void;

  toggleSelected: (id: string) => void;
  setSelected: (ids: string[]) => void;
  clearSelection: () => void;

  openMessage: (id: string) => void;
  /** Deep-link opener: fetches the message first when it isn't in the union. */
  openById: (id: string) => Promise<void>;
  closeMessage: () => void;

  toggleStar: (id: string) => void;
  setRead: (ids: string[], read: boolean) => void;
  archive: (ids: string[]) => void;
  remove: (ids: string[]) => void;
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
  };
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

    set({
      messages: messages.map((message) =>
        target.has(message.id) ? change(message) : message,
      ),
      selectedIds: [],
      undo: { label, snapshot, ...(revert ? { revert } : {}) },
      openId: target.has(get().openId ?? "") ? null : get().openId,
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

  /** Forget cached pages so the next visit refetches them. */
  const invalidate = (...keys: string[]) =>
    set((state) => ({
      pages: Object.fromEntries(
        Object.entries(state.pages).filter(([key]) => !keys.includes(key)),
      ),
    }));

  return {
    messages: [],
    pages: {},
    status: "idle",
    error: null,
    labels: [],
    account: null,
    prefetchSettled: false,

    filter: { kind: "view", value: "all" },
    query: EMPTY_MAIL_QUERY,
    searchOpen: false,
    selectedIds: [],
    openId: null,
    composeOpen: false,
    composeInitial: null,
    undo: null,

    /** Fetch the destination currently on screen, unless it is already held. */
    load: async (force = false) => {
      const filter = get().filter;
      const key = keyFor(filter);
      const request = requestFor(filter);

      // Local-only views have nothing to fetch; they read off the union.
      if (!request || (!force && key in get().pages)) {
        if (get().status !== "ready") set({ status: "ready", error: null });
        return;
      }

      if (loadInFlight.has(key)) return;
      loadInFlight.add(key);

      set({ status: "loading", error: null });
      try {
        const { messages, labels, account } =
          await mailApi.fetchMailbox(request);
        // The user may have moved on while this was in flight. The page is
        // still worth keeping, but it must not clear the spinner belonging to
        // whichever view they are now looking at.
        const stillShowing = keyFor(get().filter) === key;
        set((state) => ({
          ...absorb(state.messages, state.pages, key, messages),
          labels,
          account,
          ...(stillShowing ? { status: "ready" as const } : {}),
        }));
      } catch (error) {
        set({
          status: "error",
          error: errorMessage(error, "Couldn't load your mailbox"),
        });
      } finally {
        loadInFlight.delete(key);
      }
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
      const key = keyFor({ kind: "view", value: "all" });
      set({
        messages: mailbox.messages,
        labels: mailbox.labels,
        account: mailbox.account,
        pages: { [key]: mailbox.messages.map((message) => message.id) },
        status: "ready",
        error: null,
      });
    },

    settlePrefetch: () => set({ prefetchSettled: true }),

    setFilter: (filter) => {
      set({ filter, selectedIds: [], openId: null, undo: null });
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
    setSelected: (ids) => set({ selectedIds: ids }),
    clearSelection: () => set({ selectedIds: [] }),

    /**
     * Opening a row marks it read in Gmail and pulls the full body — the list
     * is fetched with metadata only, so `body` is empty until now.
     */
    openMessage: (id) => {
      const message = get().messages.find((candidate) => candidate.id === id);
      set({ openId: id, selectedIds: [] });

      if (message?.unread) {
        patch([id], (target) => ({ ...target, unread: false }));
        confirm(() => mailApi.setRead([id], true));
      }
      if (message && !message.body) {
        void mailApi
          .fetchMessageBody(id)
          .then((full) => patch([id], () => full))
          .catch((error: unknown) =>
            set({ error: errorMessage(error, "Couldn't open that message") }),
          );
      }
    },
    closeMessage: () => set({ openId: null }),

    /**
     * Opens a message by id even when the current page does not carry it —
     * used by the `/mail/[id]` deep link. Fetches the full message first so the
     * reader has a body, then falls back to the normal open path.
     */
    openById: async (id) => {
      if (get().messages.some((message) => message.id === id)) {
        get().openMessage(id);
        return;
      }
      try {
        const full = await mailApi.fetchMessageBody(id);
        set((state) => ({
          messages: state.messages.some((message) => message.id === id)
            ? state.messages
            : [...state.messages, full],
          openId: id,
          selectedIds: [],
        }));
      } catch (error) {
        set({ error: errorMessage(error, "Couldn't open that message") });
      }
    },

    toggleStar: (id) => {
      const starred = !get().messages.find((m) => m.id === id)?.starred;
      patch([id], (message) => ({ ...message, starred }));
      confirm(() => mailApi.setStarred([id], starred));
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
      set({ composeOpen: false, composeInitial: null });
      try {
        await mailApi.sendMail(toOutgoing(draft));
        set({ undo: { label: "Message sent", snapshot: [] } });
        // Sent now holds one more message than the cached page does; drop it so
        // opening Sent fetches rather than showing a stale list.
        invalidate("view:sent", "view:drafts");
        await get().load(true);
      } catch (error) {
        set({ error: errorMessage(error, "Couldn't send that message") });
      }
    },

    saveDraft: async (draft) => {
      set({ composeOpen: false, composeInitial: null });
      try {
        await mailApi.saveDraft(toOutgoing(draft));
        set({ undo: { label: "Draft saved", snapshot: [] } });
        invalidate("view:drafts");
        await get().load(true);
      } catch (error) {
        set({ error: errorMessage(error, "Couldn't save that draft") });
      }
    },

    openCompose: (initial) =>
      set({ composeOpen: true, composeInitial: initial ?? null }),
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
