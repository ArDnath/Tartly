"use client";

import * as React from "react";

import { useMailStore } from "@/components/app/mail/mail-store";
import { conversationMessageIds } from "@/lib/mail/conversations";
import type { MailConversation } from "@/lib/mail/types";

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)
  );
}

interface Options {
  conversations: MailConversation[];
  focusedThreadId: string | null;
  setFocusedThreadId: (id: string | null) => void;
}

/**
 * Gmail's single-key shortcuts, conversation-scoped like the list. They stay
 * off while a field has focus or a dialog owns the screen, so typing never
 * triggers a destructive action.
 */
export function useMailShortcuts({
  conversations,
  focusedThreadId,
  setFocusedThreadId,
}: Options) {
  const store = useMailStore;

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = store.getState();
      if (state.composeOpen || isTyping(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const index = conversations.findIndex(
        (conversation) => conversation.threadId === focusedThreadId,
      );
      const targetId = state.openThreadId ?? focusedThreadId;
      const target = conversations.find(
        (conversation) => conversation.threadId === targetId,
      );
      const targetIds = target
        ? conversationMessageIds(target)
        : targetId
          ? [targetId]
          : [];

      const move = (delta: number) => {
        if (!conversations.length) return;
        const next = Math.min(
          Math.max(index === -1 ? 0 : index + delta, 0),
          conversations.length - 1,
        );
        setFocusedThreadId(conversations[next].threadId);
      };

      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault();
          move(1);
          break;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          move(-1);
          break;
        case "Enter":
        case "o":
          if (focusedThreadId && !state.openThreadId) {
            event.preventDefault();
            void state.openConversation(focusedThreadId);
          }
          break;
        case "u":
        case "Escape":
          if (state.openThreadId) state.closeConversation();
          else if (state.searchOpen) state.setSearchOpen(false);
          else if (state.selectedIds.length) state.clearSelection();
          break;
        case "e":
          if (targetIds.length) {
            event.preventDefault();
            state.archive(
              state.selectedIds.length ? state.selectedIds : targetIds,
            );
          }
          break;
        case "#":
          if (targetIds.length) {
            event.preventDefault();
            state.remove(
              state.selectedIds.length ? state.selectedIds : targetIds,
            );
          }
          break;
        case "s":
          if (target) {
            event.preventDefault();
            state.setStarred(targetIds, !target.starred);
          }
          break;
        case "x":
          if (focusedThreadId && !state.openThreadId) {
            event.preventDefault();
            const focused = conversations.find(
              (conversation) => conversation.threadId === focusedThreadId,
            );
            if (focused) state.toggleSelectedMany(conversationMessageIds(focused));
          }
          break;
        case "c":
          event.preventDefault();
          state.openCompose();
          break;
        case "/":
          event.preventDefault();
          state.setSearchOpen(true);
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [conversations, focusedThreadId, setFocusedThreadId, store]);
}
