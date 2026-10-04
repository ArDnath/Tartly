"use client";

import {
  BookOpen,
  CalendarDays,
  FolderOpen,
  ListChecks,
  Moon,
  Settings2,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export type SettingsLink = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export type SettingsGroup = { label: string; links: SettingsLink[] };

/**
 * Settings destinations, grouped so the rail reads as two short menus rather
 * than one long list. The order defines both the desktop rail and the mobile
 * tab strip.
 *
 * Exported so the intercepted settings modal can render the same rail without
 * duplicating the list.
 */
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: "Workspace",
    links: [
      { href: "/settings/calendar", label: "Calendar", icon: CalendarDays },
      { href: "/settings/assets", label: "Assets", icon: FolderOpen },
    ],
  },
  {
    label: "Assistant",
    links: [
      {
        href: "/settings/writing-style",
        label: "Voice & memory",
        icon: Sparkles,
      },
      { href: "/settings/knowledge", label: "Knowledge", icon: BookOpen },
      { href: "/settings/senders", label: "Senders", icon: Users },
      { href: "/settings/rules", label: "Rules", icon: ListChecks },
      { href: "/settings/autopilot", label: "24/7 Autopilot", icon: Moon },
    ],
  },
];

const LINKS = SETTINGS_GROUPS.flatMap((group) => group.links);

/**
 * Settings navigation. Lives in the main column (not the app sidebar) so the
 * section list opens as a proper settings surface: a vertical rail beside the
 * content on desktop, a scrollable tab strip above it on mobile.
 */
export function SettingsNav() {
  const pathname = usePathname();

  return (
    <>
      <nav
        aria-label="Settings"
        className="hidden w-60 shrink-0 flex-col border-r border-border bg-mail-rail lg:flex"
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
          <Settings2
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="text-[13px] font-semibold tracking-tight text-foreground">
            Settings
          </span>
        </div>

        <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-2.5 py-4">
          {SETTINGS_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <p className="px-2.5 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              {group.links.map((link) => (
                <SettingsRailLink
                  key={link.href}
                  link={link}
                  active={pathname === link.href}
                />
              ))}
            </div>
          ))}
        </div>
      </nav>

      <div
        aria-label="Settings"
        className="scrollbar-none flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 py-2 lg:hidden"
      >
        {LINKS.map((link) => (
          <SettingsTab
            key={link.href}
            link={link}
            active={pathname === link.href}
          />
        ))}
      </div>
    </>
  );
}

function SettingsRailLink({
  link,
  active,
}: {
  link: SettingsLink;
  active: boolean;
}) {
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13px] transition-colors",
        active
          ? "bg-mail-rail-active font-medium text-foreground"
          : "text-muted-foreground hover:bg-mail-rail-active hover:text-foreground",
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          active
            ? "text-foreground"
            : "text-muted-foreground group-hover:text-foreground",
        )}
        aria-hidden
      />
      <span className="truncate">{link.label}</span>
    </Link>
  );
}

function SettingsTab({
  link,
  active,
}: {
  link: SettingsLink;
  active: boolean;
}) {
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] transition-colors",
        active
          ? "border-transparent bg-mail-rail-active font-medium text-foreground"
          : "border-border text-muted-foreground hover:bg-mail-rail-active hover:text-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="whitespace-nowrap">{link.label}</span>
    </Link>
  );
}
