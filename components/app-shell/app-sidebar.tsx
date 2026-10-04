"use client";

import * as React from "react";
import type { Icon } from "@phosphor-icons/react";
import {
  Bell,
  CalendarDots,
  CaretDown,
  ChartBar,
  CheckCircle,
  Clock,
  Command,
  FileText,
  GearSix,
  MagnifyingGlass,
  Megaphone,
  PaperPlaneTilt,
  PencilSimpleLine,
  Plus,
  SignOut,
  Star,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { useSignOut } from "@/components/auth-buttons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useMailStore } from "@/components/mail/mail-store";
import { countDestinations } from "@/lib/mail/filter";
import type { MailFilter, MailView } from "@/lib/mail/types";
import { cn } from "@/lib/utils";
import logo from "@/public/logo.png";

/** Signed-in user shown at the top of the rail. */
export type SidebarUser = {
  name: string;
  image: string | null;
};

/**
 * Destinations that are not mail. These are the routes the app keeps; the mail
 * hub itself is the default screen and lives under the Labels / Mail sections
 * rather than as a nav row.
 */
const NAV_ITEMS: Array<{
  href: string;
  label: string;
  icon: Icon;
  /** Route prefix that marks the item active. */
  match: string;
}> = [
  {
    href: "/calendar",
    label: "Calendar",
    icon: CalendarDots,
    match: "/calendar",
  },
  { href: "/followups", label: "Follow-ups", icon: Clock, match: "/followups" },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone, match: "/campaigns" },
  { href: "/activity", label: "Activity", icon: ChartBar, match: "/activity" },
  {
    href: "/settings/calendar",
    label: "Settings",
    icon: GearSix,
    match: "/settings",
  },
];

/**
 * Mail folders. `all` (the inbox) sits under Labels to mirror the reference
 * layout, so it is intentionally absent here.
 */
const MAIL_ROWS: Array<{
  view: MailView;
  label: string;
  icon: Icon;
  /** Sent / Done / Trash / Spam carry no count in the design. */
  showCount: boolean;
}> = [
  { view: "starred", label: "Starred", icon: Star, showCount: true },
  { view: "reminders", label: "Reminders", icon: Bell, showCount: true },
  { view: "scheduled", label: "Scheduled", icon: Clock, showCount: true },
  { view: "drafts", label: "Drafts", icon: FileText, showCount: true },
  { view: "sent", label: "Sent", icon: PaperPlaneTilt, showCount: false },
  { view: "done", label: "Done", icon: CheckCircle, showCount: false },
  { view: "trash", label: "Trash", icon: Trash, showCount: false },
  { view: "spam", label: "Spam", icon: WarningCircle, showCount: false },
];

/** Opens the command palette (mounted once in `AppShell`). */
export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent("app:command"));
}

function sameFilter(a: MailFilter, b: MailFilter): boolean {
  return a.kind === b.kind && a.value === b.value;
}

/** One row in the rail: optional glyph, label, optional trailing count. */
function RailRow({
  icon: Icon,
  label,
  count,
  active,
  onClick,
}: {
  icon?: Icon;
  label: string;
  count?: number;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-9 items-center gap-3 rounded-lg px-3 text-left text-[14px] transition-colors",
        active
          ? "bg-mail-rail-active font-semibold text-foreground"
          : "text-muted-foreground hover:bg-mail-rail-active hover:text-foreground",
      )}
    >
      {Icon ? (
        <Icon
          className={cn(
            "size-[18px] shrink-0",
            active
              ? "text-foreground"
              : "text-muted-foreground group-hover:text-foreground",
          )}
          aria-hidden
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === "number" ? (
        <span
          className={cn(
            "shrink-0 text-[13px] tabular-nums",
            active ? "font-medium text-foreground" : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

/** Collapsible section label ("Labels", "Mail"). */
function SectionToggle({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex h-8 items-center justify-between rounded-lg px-3 text-left"
    >
      <span className="text-[13px] font-medium text-muted-foreground">
        {label}
      </span>
      <CaretDown
        className={cn(
          "size-3.5 text-muted-foreground transition-transform",
          !open && "-rotate-90",
        )}
        aria-hidden
      />
    </button>
  );
}

/** Inline "Add label" affordance at the foot of the Labels list. */
function AddLabelRow() {
  const addLabel = useMailStore((state) => state.addLabel);
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    addLabel(trimmed);
    setName("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-[14px] text-muted-foreground transition-colors hover:bg-mail-rail-active hover:text-foreground">
        <Plus className="size-[18px]" aria-hidden />
        <span className="flex-1">Add label</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label
            htmlFor="mail-new-label"
            className="text-[12px] font-medium text-muted-foreground"
          >
            New label
          </label>
          <Input
            id="mail-new-label"
            value={name}
            autoFocus
            placeholder="e.g. Investors"
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" size="sm" className="self-end">
            Create
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** "Ariyaman Sharma" → "AS"; falls back to a neutral glyph. */
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return `${parts[0][0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

/** Brand lockup at the top of the rail: mark + wordmark. */
function BrandHeader() {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
      <Image
        src={logo}
        alt="Lunabox"
        width={40}
        height={40}
        priority
        className="size-10 shrink-0 rounded-[11px] border-2 border-white object-contain"
      />
      <span className="text-[15px] font-bold tracking-tight text-foreground">
        Lunabox
      </span>
    </div>
  );
}

/**
 * Account row at the foot of the rail: avatar + name, opening a menu with
 * sign-out.
 */
function SidebarUserMenu({ user }: { user?: SidebarUser }) {
  const { signOut, isSigningOut } = useSignOut();
  const name = user?.name?.trim() || "Account";
  const image = user?.image ?? null;

  const avatar = (
    <Avatar size="sm">
      {image ? <AvatarImage src={image} alt="" /> : null}
      <AvatarFallback className="text-[11px] font-medium">
        {initialsFor(name)}
      </AvatarFallback>
    </Avatar>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-mail-rail-active"
          >
            {avatar}
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
              {name}
            </span>
            <SignOut
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </button>
        }
      />
      <DropdownMenuContent side="top" align="start" className="w-56">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          {avatar}
          <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
            {name}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={isSigningOut}
          onClick={() => void signOut()}
        >
          <SignOut className="size-3.5" />
          {isSigningOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The single left rail shared by every app screen. It reads like an email
 * client: the brand sits on top, then Compose / Search, the non-mail
 * destinations, the mail labels, and the mail folders, with the account and
 * quick actions pinned to the footer. Selecting any mail destination also
 * brings the Mail screen forward, so the rail doubles as the app's email hub.
 * `children` carries route-specific lists (settings sub-pages, chat threads,
 * inbox triage) ahead of the mail sections.
 */
export function AppSidebar({
  children,
  user,
}: {
  children?: ReactNode;
  user?: SidebarUser;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const messages = useMailStore((state) => state.messages);
  const labels = useMailStore((state) => state.labels);
  const filter = useMailStore((state) => state.filter);
  const setFilter = useMailStore((state) => state.setFilter);
  const setSearchOpen = useMailStore((state) => state.setSearchOpen);
  const openCompose = useMailStore((state) => state.openCompose);

  const [labelsOpen, setLabelsOpen] = React.useState(true);
  const [mailOpen, setMailOpen] = React.useState(true);

  // Labels and counts come from the mail store, so make sure it is populated
  // (once per session — the store caches each destination it has fetched).
  // Mail destinations navigate through `router.push` (the rail rows are
  // buttons), so prefetch the route Next can't see as a `<Link>`.
  React.useEffect(() => {
    if (!pathname.startsWith("/mail")) router.prefetch("/mail");
    // On the mail routes `MailScreen` owns the load (server-prefetched or
    // client), so the sidebar must not race it with its own Gmail request.
    if (pathname.startsWith("/mail")) return;
    const state = useMailStore.getState();
    if (state.status === "idle") void state.load();
  }, [pathname, router]);

  const inMail = pathname.startsWith("/mail");

  // One pass over the mailbox for every sidebar badge, recomputed only when the
  // messages or label set change — not on every store tick / selection.
  const counts = React.useMemo(
    () => countDestinations(messages, labels),
    [messages, labels],
  );

  const selectFilter = (next: MailFilter) => {
    setFilter(next);
    if (!inMail) router.push("/mail");
  };

  const compose = () => {
    openCompose();
    if (!inMail) router.push("/mail");
  };

  const search = () => {
    setSearchOpen(true);
    if (!inMail) router.push("/mail");
  };

  const allFilter: MailFilter = { kind: "view", value: "all" };

  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-border bg-mail-rail max-md:hidden">
      <BrandHeader />

      <div className="scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
        <div className="flex flex-col gap-0.5 px-2.5">
          <RailRow icon={PencilSimpleLine} label="Compose" onClick={compose} />
          <RailRow icon={MagnifyingGlass} label="Search" onClick={search} />
        </div>

        <nav
          aria-label="Primary"
          className="mt-1 flex flex-col gap-0.5 px-2.5"
        >
          {NAV_ITEMS.map((item) => {
            const active =
              pathname === item.match ||
              pathname.startsWith(`${item.match}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex h-9 items-center gap-3 rounded-lg px-3 text-[14px] transition-colors",
                  active
                    ? "bg-mail-rail-active font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-mail-rail-active hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "size-[18px] shrink-0",
                    active
                      ? "text-foreground"
                      : "text-muted-foreground group-hover:text-foreground",
                  )}
                  aria-hidden
                />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {children ? <div className="mt-1 shrink-0">{children}</div> : null}

        <div className="mt-4 flex flex-col px-2.5">
          <SectionToggle
            label="Labels"
            open={labelsOpen}
            onToggle={() => setLabelsOpen((open) => !open)}
          />
          {labelsOpen ? (
            <div className="flex flex-col gap-0.5">
              <RailRow
                label="All"
                count={counts.views.all}
                active={inMail && sameFilter(filter, allFilter)}
                onClick={() => selectFilter(allFilter)}
              />
              {labels.map((label) => {
                const candidate: MailFilter = { kind: "label", value: label };
                return (
                  <RailRow
                    key={label}
                    label={label}
                    count={counts.labels[label] ?? 0}
                    active={inMail && sameFilter(filter, candidate)}
                    onClick={() => selectFilter(candidate)}
                  />
                );
              })}
              <AddLabelRow />
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex flex-col px-2.5">
          <SectionToggle
            label="Mail"
            open={mailOpen}
            onToggle={() => setMailOpen((open) => !open)}
          />
          {mailOpen ? (
            <div className="flex flex-col gap-0.5">
              {MAIL_ROWS.map(({ view, label, icon, showCount }) => {
                const candidate: MailFilter = { kind: "view", value: view };
                return (
                  <RailRow
                    key={view}
                    icon={icon}
                    label={label}
                    count={
                      showCount ? counts.views[view] ?? 0 : undefined
                    }
                    active={inMail && sameFilter(filter, candidate)}
                    onClick={() => selectFilter(candidate)}
                  />
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <footer className="flex shrink-0 flex-col gap-1.5 border-t border-border p-2.5">
        <SidebarUserMenu user={user} />
        <button
          type="button"
          onClick={openCommandPalette}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-[12px] text-muted-foreground transition-colors hover:bg-mail-rail-active hover:text-foreground"
        >
          <Command className="size-4 shrink-0" aria-hidden />
          <span className="flex-1 text-left">Quick actions</span>
          <kbd className="rounded border border-border bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            ⌘K
          </kbd>
        </button>
      </footer>
    </aside>
  );
}
