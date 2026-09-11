import type { ReactNode } from "react";

import { CommandPalette } from "@/components/app-shell/command-palette";

/**
 * The app frame: a fixed sidebar column, the main column, and an optional
 * right-hand panel (e.g. a collapsible rail). The command palette rides along
 * on every app screen.
 */
export function AppShell({
  sidebar,
  panel,
  children,
}: {
  sidebar: ReactNode;
  panel?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas text-canvas-foreground">
      {sidebar}
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      {panel}
      <CommandPalette />
    </div>
  );
}
