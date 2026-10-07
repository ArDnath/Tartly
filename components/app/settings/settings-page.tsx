import type { ReactNode } from "react";

/**
 * Frame for a settings section. The title bar is exactly `h-14` so its bottom
 * rule meets the settings rail's header rule in one continuous line, and both
 * the bar and the body share one centered, max-width column so the title lines
 * up with the content beneath it.
 */
export function SettingsPage({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="h-14 shrink-0 border-b border-border">
        <div className="mx-auto flex h-full w-full max-w-3xl items-center px-6">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[14px] font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            {subtitle ? (
              <p className="truncate text-[11px] text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-8">{children}</div>
      </div>
    </div>
  );
}
