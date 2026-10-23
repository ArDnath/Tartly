"use client";

import * as React from "react";
import {
  Archive,
  ClockFading,
  Filter,
  Inbox,
  Mail,
  MailOpen,
  OctagonAlert,
  Search,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMailStore } from "@/components/app/mail/mail-store";
import { MailCheckbox } from "@/components/app/mail/mail-checkbox";
import { conversationCount } from "@/lib/mail/filter";
import { conversationMessageIds } from "@/lib/mail/conversations";
import type {
  MailConversation,
  MailFilter,
  MailTag,
} from "@/lib/mail/types";

const VIEW_TITLES: Record<string, string> = {
  all: "All Mail",
  starred: "Starred",
  reminders: "Reminders",
  scheduled: "Scheduled",
  drafts: "Drafts",
  sent: "Sent",
  done: "Done",
  trash: "Trash",
  spam: "Spam",
};

const TAGS: MailTag[] = ["important", "newsletter", "calendar", "other"];

export function mailListTitle(filter: MailFilter): string {
  return filter.kind === "label"
    ? filter.value
    : (VIEW_TITLES[filter.value] ?? "Mail");
}

/** Relative snooze targets, mirroring Gmail's default set. */
function snoozeOptions(): { label: string; at: Date }[] {
  const laterToday = new Date();
  laterToday.setHours(laterToday.getHours() + 3, 0, 0, 0);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  nextWeek.setHours(8, 0, 0, 0);
  return [
    { label: "Later today", at: laterToday },
    { label: "Tomorrow morning", at: tomorrow },
    { label: "Next week", at: nextWeek },
  ];
}

function ToolbarAction({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className="flex size-8 items-center justify-center rounded-lg text-mail-muted transition-colors hover:bg-mail-row-hover hover:text-mail-strong"
          >
            <Icon className="size-[18px]" aria-hidden />
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function SnoozeAction({ onSnooze }: { onSnooze: (at: Date) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Snooze"
        className="flex size-8 items-center justify-center rounded-lg text-mail-muted transition-colors hover:bg-mail-row-hover hover:text-mail-strong"
      >
        <ClockFading className="size-[18px]" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 gap-0.5 p-1.5">
        {snoozeOptions().map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => {
              onSnooze(option.at);
              setOpen(false);
            }}
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent"
          >
            {option.label}
            <span className="text-[12px] text-muted-foreground">
              {option.at.toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function LabelAction({ ids }: { ids: string[] }) {
  const labels = useMailStore((state) => state.labels);
  const applyLabel = useMailStore((state) => state.applyLabel);
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Apply label"
        className="flex size-8 items-center justify-center rounded-lg text-mail-muted transition-colors hover:bg-mail-row-hover hover:text-mail-strong"
      >
        <Tag className="size-[18px]" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 gap-0.5 p-1.5">
        {labels.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              applyLabel(ids, label);
              setOpen(false);
            }}
            className="rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent"
          >
            {label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function FilterPopover() {
  const query = useMailStore((state) => state.query);
  const setQuery = useMailStore((state) => state.setQuery);
  const resetQuery = useMailStore((state) => state.resetQuery);

  const active =
    query.unreadOnly ||
    query.starredOnly ||
    query.withAttachments ||
    query.tag !== null;

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Filter mail"
        className={cn(
          "flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-mail-row-hover",
          active ? "text-mail-unread" : "text-mail-strong",
        )}
      >
        <Filter className="size-5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase text-muted-foreground">
            Filter
          </span>
          {(
            [
              ["unreadOnly", "Unread only"],
              ["starredOnly", "Starred only"],
              ["withAttachments", "Has attachment"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="checkbox"
              aria-checked={query[key]}
              onClick={() => setQuery({ [key]: !query[key] })}
              className="flex items-center gap-2 rounded-md px-1 py-1 text-left text-[13px] transition-colors hover:bg-accent"
            >
              <MailCheckbox presentational checked={query[key]} label={label} />
              {label}
            </button>
          ))}

          <span className="mt-1 text-[12px] font-semibold uppercase text-muted-foreground">
            Category
          </span>
          <div className="flex flex-wrap gap-1.5">
            {TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() =>
                  setQuery({ tag: query.tag === tag ? null : tag })
                }
                className={cn(
                  "rounded-md px-2 py-1 text-[12px] capitalize transition-colors",
                  query.tag === tag
                    ? "bg-primary text-primary-foreground"
                    : "bg-mail-chip text-mail-chip-foreground hover:bg-accent",
                )}
              >
                {tag}
              </button>
            ))}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={resetQuery}
          >
            Clear filters
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface MailToolbarProps {
  /** Conversations currently rendered — drives the select-all checkbox. */
  visible: MailConversation[];
}

export function MailToolbar({ visible }: MailToolbarProps) {
  const filter = useMailStore((state) => state.filter);
  const query = useMailStore((state) => state.query);
  const setQuery = useMailStore((state) => state.setQuery);
  const messages = useMailStore((state) => state.messages);
  const selectedIds = useMailStore((state) => state.selectedIds);
  const setSelected = useMailStore((state) => state.setSelected);
  const clearSelection = useMailStore((state) => state.clearSelection);
  const archive = useMailStore((state) => state.archive);
  const remove = useMailStore((state) => state.remove);
  const restore = useMailStore((state) => state.restore);
  const snooze = useMailStore((state) => state.snooze);
  const setRead = useMailStore((state) => state.setRead);
  const setStarred = useMailStore((state) => state.setStarred);
  const markSpam = useMailStore((state) => state.markSpam);
  const deleteForever = useMailStore((state) => state.deleteForever);
  const emptyTrash = useMailStore((state) => state.emptyTrash);
  const [confirmEmpty, setConfirmEmpty] = React.useState(false);

  const searchOpen = useMailStore((state) => state.searchOpen);
  const setSearchOpen = useMailStore((state) => state.setSearchOpen);
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const closeSearch = () => setSearchOpen(false);

  const inTrash = filter.kind === "view" && filter.value === "trash";
  const inSpam = filter.kind === "view" && filter.value === "spam";

  const visibleIds = React.useMemo(
    () => visible.flatMap(conversationMessageIds),
    [visible],
  );
  const selectedSet = React.useMemo(
    () => new Set(selectedIds),
    [selectedIds],
  );
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));
  const anyUnread = visible.some(
    (conversation) =>
      conversation.unread &&
      conversation.messages.some((message) => selectedSet.has(message.id)),
  );
  // Whether every selected conversation already carries a star, so the bulk
  // action can toggle the whole selection in one direction.
  const selectedConversations = React.useMemo(
    () =>
      visible.filter((conversation) =>
        conversation.messages.some((message) => selectedSet.has(message.id)),
      ),
    [visible, selectedSet],
  );
  const allStarred =
    selectedConversations.length > 0 &&
    selectedConversations.every((conversation) => conversation.starred);
  // Gmail counts conversations in the selection bar, not messages.
  const selectedCount = React.useMemo(
    () => conversationCount(messages, selectedIds),
    [messages, selectedIds],
  );

  if (selectedIds.length > 0) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-mail-line bg-mail-surface px-6 py-3">
        <MailCheckbox
          checked={allSelected}
          indeterminate={!allSelected}
          label="Select all conversations"
          onChange={() =>
            allSelected ? clearSelection() : setSelected(visibleIds)
          }
        />
        <span className="ml-1 text-[13px] font-medium text-mail-strong">
          {selectedCount} selected
        </span>
        <div className="ml-2 flex items-center gap-1">
          {inTrash || inSpam ? (
            <ToolbarAction
              label="Move to Inbox"
              icon={Inbox}
              onClick={() => restore(selectedIds)}
            />
          ) : (
            <>
              <ToolbarAction
                label="Archive"
                icon={Archive}
                onClick={() => archive(selectedIds)}
              />
              <SnoozeAction onSnooze={(at) => snooze(selectedIds, at)} />
              <ToolbarAction
                label="Report spam"
                icon={OctagonAlert}
                onClick={() => markSpam(selectedIds, true)}
              />
            </>
          )}
          <ToolbarAction
            label={inTrash ? "Delete forever" : "Delete"}
            icon={Trash2}
            onClick={() =>
              inTrash ? deleteForever(selectedIds) : remove(selectedIds)
            }
          />
          <ToolbarAction
            label={anyUnread ? "Mark as read" : "Mark as unread"}
            icon={anyUnread ? MailOpen : Mail}
            onClick={() => setRead(selectedIds, anyUnread)}
          />
          <ToolbarAction
            label={allStarred ? "Remove star" : "Add star"}
            icon={Star}
            onClick={() => setStarred(selectedIds, !allStarred)}
          />
          <LabelAction ids={selectedIds} />
        </div>
        <button
          type="button"
          onClick={clearSelection}
          className="ml-auto flex size-8 items-center justify-center rounded-lg text-mail-muted transition-colors hover:bg-mail-row-hover"
          aria-label="Clear selection"
        >
          <X className="size-[18px]" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center justify-between gap-4 border-b border-mail-line bg-mail-surface px-6 py-3">
      {searchOpen ? (
        <div className="flex w-full items-center gap-2">
          <Search className="size-4 shrink-0 text-mail-muted" aria-hidden />
          <Input
            ref={searchRef}
            value={query.search}
            placeholder="Search mail"
            aria-label="Search mail"
            className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
            onChange={(event) => setQuery({ search: event.target.value })}
            onKeyDown={(event) => event.key === "Escape" && closeSearch()}
          />
          <button
            type="button"
            onClick={closeSearch}
            aria-label="Close search"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-mail-muted transition-colors hover:bg-mail-row-hover"
          >
            <X className="size-[18px]" aria-hidden />
          </button>
        </div>
      ) : (
        <>
          <h2 className="min-w-0 truncate text-[20px] font-bold text-mail-strong">
            {mailListTitle(filter)}
          </h2>
          <div className="flex shrink-0 items-center gap-4">
            {inTrash ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmEmpty(true)}
              >
                <Trash2 className="size-4" aria-hidden />
                Empty trash
              </Button>
            ) : null}
            <FilterPopover />
            <button
              type="button"
              aria-label="Search mail"
              onClick={() => setSearchOpen(true)}
              className="flex size-8 items-center justify-center rounded-lg text-mail-strong transition-colors hover:bg-mail-row-hover"
            >
              <Search className="size-5" aria-hidden />
            </button>
          </div>
        </>
      )}

      <Dialog open={confirmEmpty} onOpenChange={setConfirmEmpty}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Empty trash?</DialogTitle>
            <DialogDescription>
              Everything in Trash will be permanently deleted. This can&apos;t be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmEmpty(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmEmpty(false);
                void emptyTrash();
              }}
            >
              Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
