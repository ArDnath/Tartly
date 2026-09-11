"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AppSidebar, type SidebarUser } from "@/components/app-shell/app-sidebar";
import type { InboxCounts, InboxView } from "@/lib/inbox/service";
import { cn } from "@/lib/utils";

const VIEWS: Array<{ value: InboxView; label: string }> = [
  { value: "needs_you", label: "Needs you" },
  { value: "waiting", label: "Waiting" },
  { value: "handled", label: "Handled" },
];

/** Inbox-specific sidebar: the three triage views, each with a live count. */
export function InboxSidebar({
  counts,
  user,
}: {
  counts: InboxCounts;
  user?: SidebarUser;
}) {
  const searchParams = useSearchParams();
  const active = (searchParams.get("view") as InboxView | null) ?? "needs_you";

  return (
    <AppSidebar user={user}>
      <div className="flex flex-col gap-1 px-2.5">
        <p className="px-2.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Inbox
        </p>
        {VIEWS.map((view) => {
          const isActive = active === view.value;
          return (
            <Link
              key={view.value}
              href={`/inbox?view=${view.value}`}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] transition-colors",
                isActive
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <span className="flex-1 truncate">{view.label}</span>
              <span
                className={cn(
                  "shrink-0 text-[11px] tabular-nums",
                  isActive ? "text-foreground/70" : "text-muted-foreground",
                )}
              >
                {counts[view.value]}
              </span>
            </Link>
          );
        })}
      </div>

      <div className="mt-auto px-4 pb-2">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Your assistant triages mail, drafts replies and books meetings. You
          approve what leaves.
        </p>
      </div>
    </AppSidebar>
  );
}
