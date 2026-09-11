import * as React from "react";
import { Check, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

interface MailCheckboxProps {
  checked: boolean;
  /** Renders the dash state used by a partial select-all. */
  indeterminate?: boolean;
  label: string;
  onChange?: () => void;
  /**
   * Render as a plain box with no button semantics, for when an enclosing
   * control already owns the click (nesting buttons is invalid HTML).
   */
  presentational?: boolean;
  className?: string;
}

/** 16px square selector used on rows and in the bulk-action bar. */
export function MailCheckbox({
  checked,
  indeterminate,
  label,
  onChange,
  presentational,
  className,
}: MailCheckboxProps) {
  const partial = !checked && indeterminate;

  const box = cn(
    "flex size-4 shrink-0 items-center justify-center rounded-[2px] border-2 transition-colors",
    checked || partial
      ? "border-mail-unread bg-mail-unread text-white"
      : "border-border hover:border-mail-muted",
    className,
  );

  const mark = (
    <>
      {checked && <Check className="size-3" strokeWidth={3} aria-hidden />}
      {partial && <Minus className="size-3" strokeWidth={3} aria-hidden />}
    </>
  );

  if (presentational) {
    return (
      <span aria-hidden className={box}>
        {mark}
      </span>
    );
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={partial ? "mixed" : checked}
      aria-label={label}
      onClick={(event: React.MouseEvent) => {
        event.stopPropagation();
        onChange?.();
      }}
      className={box}
    >
      {mark}
    </button>
  );
}
