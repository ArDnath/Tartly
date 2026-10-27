"use client";

import { GearSix, X } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";

import {
  SETTINGS_GROUPS,
  type SettingsLink,
} from "@/components/app/settings/settings-nav";
import { settingsSectionForPath } from "@/components/app/settings/settings-sections";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * The settings surface as a popup. Reached by intercepting `/settings/*`, so
 * clicking Settings anywhere in the app opens this over the current screen
 * while the underlying URL still names the section, and a hard load of that URL
 * falls back to the full-page settings route.
 *
 * The chrome (rail, tabs, header) lives in the intercepted route's layout, so
 * switching sections swaps only `children` — the backdrop and rail never
 * remount and nothing outside the panel re-renders. The current section's copy
 * is derived from the pathname rather than passed in, which is what lets the
 * layout outlive each section page.
 *
 * The panel is deliberately glassmorphic: a translucent, blurred sheet with a
 * hairline highlight and a soft sheen, so the app stays faintly visible behind
 * it instead of the modal reading as another opaque page. A mild backdrop blur
 * softens everything outside the panel.
 *
 * The section bodies are server components passed in as `children`; only the
 * chrome (rail, tabs, close) is client.
 *
 * Section links `replace` rather than push: a tab switch is not a place in
 * history, so `router.back()` — the single "dismiss" path shared by the close
 * button, Escape and the backdrop — always unwinds to the screen the modal was
 * opened over instead of stepping through previously viewed sections.
 */
export function SettingsModal({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { title, subtitle } = settingsSectionForPath(pathname);
  const bodyRef = useRef<HTMLDivElement>(null);

  // A section change is still a route change. The chrome stays mounted, but the
  // content pane should start each section at the top rather than inheriting
  // the scroll offset of the previous one.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  const close = () => router.back();

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Backdrop click / Escape is the same intent as the close button.
        if (!open) close();
      }}
    >
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/35 supports-backdrop-filter:backdrop-blur-sm"
        className={cn(
          "glass-panel flex h-[min(780px,calc(100dvh-1.5rem))] w-[min(1080px,calc(100vw-1.5rem))] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-none lg:flex-row",
          "bg-popover/70 backdrop-blur-2xl backdrop-saturate-150 supports-[backdrop-filter]:bg-popover/40",
          "ring-1 ring-foreground/10",
          "shadow-[0_30px_90px_-30px_rgba(0,0,0,0.9),inset_0_1px_0_0_rgba(255,255,255,0.08)]",
        )}
      >
        {/* Desktop rail */}
        <nav
          aria-label="Settings"
          className="hidden w-60 shrink-0 flex-col border-r border-foreground/10 bg-foreground/[0.02] lg:flex"
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-foreground/10 px-4">
            <GearSix
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
                  <ModalRailLink
                    key={link.href}
                    link={link}
                    active={pathname === link.href}
                  />
                ))}
              </div>
            ))}
          </div>
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Mobile tab strip */}
          <div
            aria-label="Settings"
            className="scrollbar-none flex shrink-0 gap-1 overflow-x-auto border-b border-foreground/10 px-3 py-2 lg:hidden"
          >
            {SETTINGS_GROUPS.flatMap((group) => group.links).map((link) => (
              <ModalTab
                key={link.href}
                link={link}
                active={pathname === link.href}
              />
            ))}
          </div>

          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-foreground/10 px-5">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-[14px] font-semibold tracking-tight text-foreground">
                {title}
              </DialogTitle>
              <DialogDescription
                className={cn(
                  "truncate text-[11px] text-muted-foreground",
                  !subtitle && "sr-only",
                )}
              >
                {subtitle ?? `Adjust your ${title.toLowerCase()} settings.`}
              </DialogDescription>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close settings"
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          </header>

          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-6 py-8">
              {children}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModalRailLink({
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
      replace
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13px] transition-colors",
        active
          ? "bg-foreground/10 font-medium text-foreground"
          : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
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

function ModalTab({ link, active }: { link: SettingsLink; active: boolean }) {
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      replace
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] transition-colors",
        active
          ? "border-transparent bg-foreground/10 font-medium text-foreground"
          : "border-foreground/10 text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="whitespace-nowrap">{link.label}</span>
    </Link>
  );
}
