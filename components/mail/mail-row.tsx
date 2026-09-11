"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import {
  Archive,
  ClockFading,
  Ellipsis,
  Paperclip,
  SquareArrowUpLeft,
  Star,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useMailStore } from "@/components/mail/mail-store";
import { formatMailTime } from "@/lib/mail/format";
import { MailCheckbox } from "@/components/mail/mail-checkbox";
import { MailTagBadge } from "@/components/mail/mail-tag-badge";
import type { MailRowMenuHandle } from "@/components/mail/mail-row-menu";
import type { MailMessage } from "@/lib/mail/types";

interface MailRowProps {
  message: MailMessage;
  selected: boolean;
  /** Keyboard cursor position — outlines the row without opening it. */
  focused: boolean;
  /** Shared "more actions" popover handle — see MailRowMenu. */
  menuHandle: MailRowMenuHandle;
}

function RowAction({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex size-7 items-center justify-center rounded-md text-mail-muted transition-colors hover:bg-mail-line hover:text-mail-strong"
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

function tomorrowMorning(): Date {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  return tomorrow;
}

function MailRowComponent({
  message,
  selected,
  focused,
  menuHandle,
}: MailRowProps) {
  const toggleSelected = useMailStore((state) => state.toggleSelected);
  const toggleStar = useMailStore((state) => state.toggleStar);
  const openMessage = useMailStore((state) => state.openMessage);
  const archive = useMailStore((state) => state.archive);
  const remove = useMailStore((state) => state.remove);
  const snooze = useMailStore((state) => state.snooze);

  const sender = message.senderLine ?? message.from.name;

  // `data-popup-open` is set by Base UI only on the trigger that currently
  // owns the shared popover (see MailRowMenu) — never on the others. Reading
  // it via :has() means the strip that opened the menu stays visible without
  // any state of our own, and it clears itself the instant a different row's
  // trigger takes over, which is what a plain boolean per row couldn't do.
  const menuOpenSelector = "group-has-[[data-popup-open]]/row";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${message.unread ? "Unread. " : ""}${sender}: ${message.subject}`}
      onClick={() => openMessage(message.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openMessage(message.id);
        }
      }}
      className={cn(
        // Fixed height so the hover actions (taller than the resting timestamp)
        // can never change a row's height and shove its neighbours around.
        "group/row relative flex h-10 w-full cursor-pointer items-center gap-3 border-b border-mail-line pl-4 pr-6 text-left",
        "transition-[background-color,box-shadow,transform] duration-150 ease-out",
        selected
          ? "bg-mail-row-selected"
          : "bg-mail-surface hover:bg-mail-row-hover",
        // The lift: a translate + shadow (compositor-only) raise the hovered row
        // without reflowing anything around it.
        "hover:z-10 hover:-translate-y-px hover:shadow-row-lift",
        focused && "ring-1 ring-inset ring-mail-unread",
      )}
    >
      {/* Unread dot swaps to a checkbox on hover, exactly as Gmail does. */}
      <div className="flex w-10 shrink-0 items-center gap-2">
        <div className="flex size-4 items-center justify-center">
          <div
            className={cn(
              "size-4 items-center justify-center",
              selected ? "flex" : "hidden group-hover/row:flex",
            )}
          >
            <MailCheckbox
              checked={selected}
              label={`Select ${message.subject}`}
              onChange={() => toggleSelected(message.id)}
            />
          </div>
          {message.unread && (
            <span
              aria-hidden
              className={cn(
                "size-[7px] rounded-full bg-mail-unread",
                selected ? "hidden" : "block group-hover/row:hidden",
              )}
            />
          )}
        </div>
        <button
          type="button"
          aria-label={message.starred ? "Remove star" : "Add star"}
          aria-pressed={message.starred}
          onClick={(event) => {
            event.stopPropagation();
            toggleStar(message.id);
          }}
          className={cn(
            "flex size-4 items-center justify-center transition-opacity",
            message.starred
              ? "opacity-100"
              : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
          )}
        >
          <Star
            className={cn(
              "size-4 transition-colors",
              message.starred
                ? "fill-warning text-warning"
                : "text-mail-muted hover:text-mail-strong",
            )}
            aria-hidden
          />
        </button>
      </div>

      <div className="flex w-[112px] shrink-0 items-center gap-1 lg:w-[140px] xl:w-[168px]">
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[14px]",
            message.unread
              ? "font-bold text-mail-unread"
              : "text-mail-strong/70",
          )}
        >
          {sender}
        </span>
        {!!message.draftCount && (
          <span className="shrink-0 text-[14px]">
            <span className="font-semibold text-mail-draft">Draft </span>
            <span className="text-mail-muted">{message.draftCount}</span>
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-[14px]">
          <span
            className={cn(
              message.unread
                ? "font-bold text-mail-strong"
                : "font-medium text-mail-strong/70",
            )}
          >
            {message.subject || "(no subject)"}
          </span>
          <span className="text-mail-muted"> — {message.preview}</span>
        </p>
        {/* Attachment chips are the first thing to go when the row tightens,
            and they fade out under the floating actions on hover so the
            toolbar reads cleanly. */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-2 transition-opacity duration-150",
            "group-hover/row:opacity-0",
            `${menuOpenSelector}:opacity-0`,
          )}
        >
          {message.attachments?.map((attachment) => (
            <span
              key={attachment.id}
              title={`${attachment.name} · ${attachment.size}`}
              className="hidden max-w-[130px] items-center gap-1.5 rounded-sm bg-mail-chip px-2 py-[3px] text-[11px] font-medium text-mail-chip-foreground xl:flex"
            >
              <Paperclip className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{attachment.name}</span>
            </span>
          ))}
          <MailTagBadge tag={message.tag} className="hidden sm:inline-block" />
        </div>
      </div>

      {/* Time and actions occupy one fixed-width box. The actions are taken out
          of flow (absolutely positioned, growing leftward over the subject) and
          revealed with opacity, so hovering never changes the column's width or
          the row's height — the subject no longer reflows under the cursor. */}
      <div className="relative flex h-full w-16 shrink-0 items-center justify-end">
        <div
          className={cn(
            "flex items-center gap-2 transition-opacity duration-150",
            "group-hover/row:opacity-0",
            `${menuOpenSelector}:opacity-0`,
          )}
        >
          {message.replied && (
            <SquareArrowUpLeft
              className="size-3.5 text-mail-muted"
              aria-hidden
            />
          )}
          <span className="text-[13px] text-mail-muted">
            {formatMailTime(message.receivedAt)}
          </span>
        </div>
        <div
          className={cn(
            "pointer-events-none absolute top-1/2 right-0 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-lg border border-mail-line bg-mail-row-hover p-0.5 opacity-0 shadow-row-lift transition-opacity duration-150",
            "group-hover/row:pointer-events-auto group-hover/row:opacity-100",
            "focus-within:pointer-events-auto focus-within:opacity-100",
            `${menuOpenSelector}:pointer-events-auto ${menuOpenSelector}:opacity-100`,
          )}
        >
          <RowAction
            label="Archive"
            icon={Archive}
            onClick={() => archive([message.id])}
          />
          <RowAction
            label="Snooze until tomorrow"
            icon={ClockFading}
            onClick={() => snooze([message.id], tomorrowMorning())}
          />
          <RowAction
            label="Delete"
            icon={Trash2}
            onClick={() => remove([message.id])}
          />
          <PopoverPrimitive.Trigger
            handle={menuHandle}
            payload={message}
            id={message.id}
            aria-label="More actions"
            onClick={(event) => event.stopPropagation()}
            className="flex size-7 items-center justify-center rounded-md text-mail-muted transition-colors hover:bg-mail-line hover:text-mail-strong"
          >
            <Ellipsis className="size-4" aria-hidden />
          </PopoverPrimitive.Trigger>
        </div>
      </div>
    </div>
  );
}

/**
 * Memoized so selecting or keyboard-focusing a row only re-renders the rows
 * whose `selected`/`focused` props actually changed. With the store's stable
 * action references (zustand) and stable `message`/`menuHandle` props, the
 * default shallow comparison is enough.
 */
export const MailRow = React.memo(MailRowComponent);
