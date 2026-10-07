import type { ReactNode } from "react";

/** Shared page header: title, optional subtitle, and a right-aligned slot. */
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border px-5 py-2.5">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[14px] font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle ? (
          <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </header>
  );
}
