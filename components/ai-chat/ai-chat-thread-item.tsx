"use client";

import {
  Archive,
  ArchiveRestore,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState, type KeyboardEvent, type MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ChatThread } from "@/lib/ai/chat-types";

type AiChatThreadItemProps = {
  thread: ChatThread;
  isActive: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onToggleArchive: () => void;
  onRequestDelete: () => void;
};

export const AiChatThreadItem = ({
  thread,
  isActive,
  onSelect,
  onRename,
  onToggleArchive,
  onRequestDelete,
}: AiChatThreadItemProps) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(thread.title ?? "");
  const isArchived = Boolean(thread.archivedAt);

  const startRename = () => {
    setDraftTitle(thread.title ?? "");
    setIsRenaming(true);
  };

  const commitRename = () => {
    setIsRenaming(false);
    const next = draftTitle.trim();
    if (next && next !== thread.title) onRename(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsRenaming(false);
    }
  };

  const stop = (event: MouseEvent) => event.stopPropagation();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        if (!isRenaming) onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !isRenaming) onSelect();
      }}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        isActive
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      {isRenaming ? (
        <Input
          value={draftTitle}
          autoFocus
          onChange={(event) => setDraftTitle(event.target.value)}
          onFocus={(event) => event.target.select()}
          onBlur={commitRename}
          onKeyDown={handleKeyDown}
          onClick={stop}
          className="h-7 text-sm"
        />
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">
            {thread.title ?? "New chat"}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Chat actions"
                  onClick={stop}
                  className="size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 data-[popup-open]:opacity-100"
                >
                  <MoreVertical className="size-3.5" />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={startRename}>
                <Pencil className="size-3.5" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggleArchive}>
                {isArchived ? (
                  <ArchiveRestore className="size-3.5" />
                ) : (
                  <Archive className="size-3.5" />
                )}
                {isArchived ? "Unarchive" : "Archive"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onRequestDelete}>
                <Trash2 className="size-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  );
};
