"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

/**
 * ⌘K palette shell, mounted once in `AppShell`. It mirrors Slashy's
 * keyboard-first feel: every destination and the common inbox action are
 * reachable without touching the mouse. Opening is driven by ⌘K/Ctrl-K or the
 * sidebar button (which dispatches `app:command`).
 *
 * The `cmdk` runtime and the palette list live in a lazily loaded module, so
 * they are fetched on first open rather than shipped with every route. The
 * mounted-once dialog keeps its close animation after the first open.
 */
const CommandPaletteDialog = dynamic(
  () =>
    import("@/components/app-shell/command-palette-dialog").then(
      (module) => module.CommandPaletteDialog,
    ),
  { ssr: false },
);

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  // Keep the dialog mounted after its first open so its exit animation plays.
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setHasOpened(true);
        setOpen((current) => !current);
      }
    };
    const onCommand = () => {
      setHasOpened(true);
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("app:command", onCommand);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("app:command", onCommand);
    };
  }, []);

  if (!hasOpened) return null;
  return <CommandPaletteDialog open={open} onOpenChange={setOpen} />;
}
