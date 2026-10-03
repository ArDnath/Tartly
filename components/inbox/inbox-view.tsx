"use client";

import { Inbox as InboxIcon, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { InboxRow } from "@/components/inbox/inbox-row";
import { AutopilotOptInCard } from "@/components/inbox/autopilot-opt-in-card";
import { DigestPanel } from "@/components/inbox/digest-panel";
import { Button } from "@/components/ui/button";
import type { InboxItem, InboxView as InboxViewName } from "@/lib/inbox/service";
import type { DigestPayload } from "@/lib/inbox/digest-types";
import { cn } from "@/lib/utils";

const VIEW_META: Record<
  InboxViewName,
  { title: string; subtitle: string }
> = {
  needs_reply: {
    title: "Needs reply",
    subtitle: "Threads waiting on a reply, a decision or a time to meet.",
  },
  waiting: {
    title: "Waiting on someone",
    subtitle: "You replied — the ball is in their court.",
  },
  follow_up_today: {
    title: "Follow up today",
    subtitle: "Active follow-ups due by the end of your day.",
  },
  meetings: {
    title: "Meetings",
    subtitle: "Upcoming meetings and open meeting requests.",
  },
  ai_handled: {
    title: "AI handled",
    subtitle: "Threads the operator replied to on its own — logged and reversible.",
  },
  fyi: {
    title: "FYI",
    subtitle: "Invoices, newsletters, notifications and the rest of the noise.",
  },
};

const TABS: Array<{ value: InboxViewName; label: string }> = [
  { value: "needs_reply", label: "Needs reply" },
  { value: "waiting", label: "Waiting" },
  { value: "follow_up_today", label: "Follow up" },
  { value: "meetings", label: "Meetings" },
  { value: "ai_handled", label: "AI handled" },
  { value: "fyi", label: "FYI" },
];

function dayBucket(iso: string | null): string {
  if (!iso) return "Earlier";
  const then = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const days = Math.round(
    (startOfToday.getTime() - startOfThen.getTime()) / 86_400_000,
  );
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  return "Earlier";
}

function groupByDay(items: InboxItem[]): Array<{ label: string; items: InboxItem[] }> {
  const groups: Array<{ label: string; items: InboxItem[] }> = [];
  for (const item of items) {
    const label = dayBucket(item.lastMessageAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

export function InboxView({
  view,
  items: initialItems,
  digest = null,
  digestEnabled = false,
}: {
  view: InboxViewName;
  items: InboxItem[];
  digest?: DigestPayload | null;
  digestEnabled?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<InboxItem[]>(initialItems);
  const [focused, setFocused] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [synced, setSynced] = useState({ view, items: initialItems });

  // When the server sends a new view (or refreshed items), adopt it. Adjusting
  // state during render is the sanctioned alternative to a setState effect.
  if (synced.view !== view || synced.items !== initialItems) {
    setSynced({ view, items: initialItems });
    setItems(initialItems);
    setFocused(-1);
  }

  const load = useCallback(
    async (target: InboxViewName) => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/v1/inbox?view=${target}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          data?: { items: InboxItem[] };
        };
        if (response.ok && payload.data) setItems(payload.data.items);
      } catch (error) {
        console.error("[inbox] failed to load", error);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  // Light polling keeps the inbox fresh without a socket.
  useEffect(() => {
    const id = setInterval(() => void load(view), 15_000);
    return () => clearInterval(id);
  }, [view, load]);

  // Keyboard-first triage: j/k (or arrows) move, Enter opens.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;
      if (key === "j" || key === "ArrowDown") {
        event.preventDefault();
        setFocused((current) => Math.min(current + 1, items.length - 1));
      } else if (key === "k" || key === "ArrowUp") {
        event.preventDefault();
        setFocused((current) => Math.max(current - 1, 0));
      } else if (key === "Enter") {
        setFocused((current) => {
          const item = items[current];
          if (item) router.push(`/inbox/${item.threadId}`);
          return current;
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items, router]);

  useEffect(() => {
    if (focused < 0) return;
    document
      .querySelector<HTMLElement>('[data-inbox-row][data-focused]')
      ?.scrollIntoView({ block: "nearest" });
  }, [focused]);

  const groups = useMemo(() => groupByDay(items), [items]);
  // Precompute positions once per items change instead of `items.indexOf` inside
  // the nested map, which was O(rows²) on every focus/poll re-render.
  const indexByThread = useMemo(
    () => new Map(items.map((item, index) => [item.threadId, index])),
    [items],
  );
  const meta = VIEW_META[view];

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await fetch("/api/v1/inbox/sync", { method: "POST" });
      await load(view);
    } catch (error) {
      console.error("[inbox] sync failed", error);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[14px] font-semibold tracking-tight text-foreground">
            {meta.title}
          </h1>
          <p className="truncate text-[11px] text-muted-foreground">
            {items.length} {items.length === 1 ? "thread" : "threads"}
            {isLoading ? " · refreshing…" : ""}
          </p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleSync}
          disabled={isSyncing}
          className="gap-1.5 text-muted-foreground"
        >
          {isSyncing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Sync now
        </Button>
      </header>

      {/* Small screens lose the sidebar, so views live in the header there. */}
      <nav className="scrollbar-none flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-3 py-2 md:hidden">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/inbox?view=${tab.value}`}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs transition-colors",
              view === tab.value
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <DigestPanel initial={digest} enabled={digestEnabled} />
      <AutopilotOptInCard />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <EmptyState view={view} />
        ) : (
          groups.map((group) => (
            <section key={group.label}>
              <p className="sticky top-0 z-10 bg-canvas/95 px-5 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground backdrop-blur">
                {group.label}
              </p>
              {group.items.map((item) => {
                const index = indexByThread.get(item.threadId) ?? -1;
                return (
                  <InboxRow
                    key={item.threadId}
                    item={item}
                    focused={index === focused}
                  />
                );
              })}
            </section>
          ))
        )}
      </div>

      <footer className="flex h-9 shrink-0 items-center gap-4 border-t border-border px-5 text-[10px] tracking-wider text-muted-foreground max-md:hidden">
        <span className="uppercase">
          <kbd className="font-sans">j</kbd>
          <kbd className="font-sans">k</kbd> move
        </span>
        <span className="uppercase">
          <kbd className="font-sans">↵</kbd> open
        </span>
        <span className="ml-auto truncate">{meta.subtitle}</span>
      </footer>
    </div>
  );
}

function EmptyState({ view }: { view: InboxViewName }) {
  const copy: Record<InboxViewName, { title: string; body: string }> = {
    needs_reply: {
      title: "You're all caught up",
      body: "Nothing needs a reply right now. New mail gets triaged, drafted and scheduled automatically.",
    },
    waiting: {
      title: "Nothing waiting",
      body: "Threads you've replied to — or that have an active follow-up — show up here.",
    },
    follow_up_today: {
      title: "No follow-ups due",
      body: "Enabled follow-ups appear here on the day they're due.",
    },
    meetings: {
      title: "No upcoming meetings",
      body: "Booked meetings and open meeting requests land here.",
    },
    ai_handled: {
      title: "Nothing handled on autopilot",
      body: "Threads the operator replied to on its own are listed here for a seven-day window.",
    },
    fyi: {
      title: "Nothing here yet",
      body: "FYI, invoices and newsletters land here once they're triaged.",
    },
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-10 items-center justify-center rounded-full border border-border text-muted-foreground">
        <InboxIcon className="size-4" />
      </span>
      <p className="text-[14px] font-medium tracking-tight text-foreground">
        {copy[view].title}
      </p>
      <p className="max-w-xs text-[12px] leading-relaxed text-muted-foreground">
        {copy[view].body}
      </p>
    </div>
  );
}
