"use client";

import * as React from "react";
import { X } from "lucide-react";

import { useMailStore } from "@/components/mail/mail-store";

/** Confirmation strip for the last batch action, with Gmail's Undo affordance. */
export function MailUndoToast() {
  const undo = useMailStore((state) => state.undo);
  const undoLast = useMailStore((state) => state.undoLast);
  const dismissUndo = useMailStore((state) => state.dismissUndo);

  React.useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(dismissUndo, 6000);
    return () => window.clearTimeout(timer);
  }, [undo, dismissUndo]);

  if (!undo) return null;

  return (
    <div
      role="status"
      className="absolute bottom-4 left-4 z-20 flex items-center gap-3 rounded-lg bg-foreground px-4 py-2.5 text-[13px] text-background shadow-fab"
    >
      <span>{undo.label}</span>
      {undo.snapshot.length > 0 && (
        <button
          type="button"
          onClick={undoLast}
          className="font-semibold text-background underline underline-offset-2"
        >
          Undo
        </button>
      )}
      <button
        type="button"
        onClick={dismissUndo}
        aria-label="Dismiss"
        className="text-background/70 transition-colors hover:text-background"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
