"use client";

import {
  ArrowsClockwise,
  ChartBar,
  Clock,
  ClockCounterClockwise,
  EnvelopeSimple,
  GearSix,
  Megaphone,
  PencilSimpleLine,
  Tray,
} from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { useMailStore } from "@/components/app/mail/mail-store";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

/**
 * The palette body. Imported lazily by `CommandPalette` so the `cmdk` runtime
 * only lands in the browser the first time someone actually opens ⌘K.
 */
export function CommandPaletteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);

  const go = useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router],
  );

  const composeMail = useCallback(() => {
    onOpenChange(false);
    // The store is a module singleton, so this seeds the mail screen's
    // composer before navigation; the ComposeDialog picks it up on mount.
    useMailStore.getState().openCompose();
    router.push("/mail");
  }, [onOpenChange, router]);

  const syncNow = useCallback(async () => {
    onOpenChange(false);
    setIsSyncing(true);
    try {
      await fetch("/api/v1/inbox/sync", { method: "POST" });
      router.refresh();
    } catch (error) {
      console.error("[command] sync failed", error);
    } finally {
      setIsSyncing(false);
    }
  }, [onOpenChange, router]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Quick actions"
      description="Navigate and act without leaving the keyboard"
    >
      <Command>
        <CommandInput placeholder="Where to?" />
        <CommandList>
          <CommandEmpty>No matching action.</CommandEmpty>
          <CommandGroup heading="Go to">
            <CommandItem onSelect={() => go("/mail")}>
              <EnvelopeSimple />
              Mail
            </CommandItem>
            <CommandItem onSelect={() => go("/inbox")}>
              <Tray />
              Inbox
            </CommandItem>
            <CommandItem onSelect={() => go("/followups")}>
              <Clock />
              Follow-ups
            </CommandItem>
            <CommandItem onSelect={() => go("/campaigns")}>
              <Megaphone />
              Campaigns
            </CommandItem>
            <CommandItem onSelect={() => go("/activity")}>
              <ChartBar />
              Activity
            </CommandItem>
            <CommandItem onSelect={() => go("/runs")}>
              <ClockCounterClockwise />
              Runs
            </CommandItem>
            <CommandItem onSelect={() => go("/settings/calendar")}>
              <GearSix />
              Settings
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Actions">
            <CommandItem disabled={isSyncing} onSelect={() => void syncNow()}>
              <ArrowsClockwise className={isSyncing ? "animate-spin" : undefined} />
              Sync inbox now
            </CommandItem>
            <CommandItem onSelect={composeMail}>
              <PencilSimpleLine />
              Compose mail
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
