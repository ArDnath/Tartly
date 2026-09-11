"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { AppSidebar, type SidebarUser } from "@/components/app-shell/app-sidebar";
import { cn } from "@/lib/utils";

// Copilot / Autopilot now lives in the chat composer, so it is not duplicated
// here. Settings keeps only configuration that is not part of a conversation.
const LINKS = [{ href: "/settings/calendar", label: "Calendar" }];

/** Settings rail: the shared primary nav plus the settings sub-pages. */
export function SettingsSidebar({ user }: { user?: SidebarUser }) {
  const pathname = usePathname();
  const inSettings = pathname.startsWith("/settings");

  return (
    <AppSidebar user={user}>
      {inSettings ? (
        <div className="flex flex-col gap-1 px-2.5">
          <p className="px-2.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Settings
          </p>
          {LINKS.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex h-8 items-center rounded-md px-2.5 text-[13px] transition-colors",
                  isActive
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </AppSidebar>
  );
}
