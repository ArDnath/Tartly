"use client";

import * as React from "react";

import { useMailStore } from "@/components/mail/mail-store";
import type { MailMessage } from "@/lib/mail/types";

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)
  );
}

interface Options {
  messages: MailMessage[];
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
}

/**
 * Gmail's single-key shortcuts. They stay off while a field has focus or a
 * dialog owns the screen, so typing never triggers a destructive action.
 */
export function useMailShortcuts({
  messages,
  focusedId,
  setFocusedId,
}: Options) {
  const store = useMailStore;

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = store.getState();
      if (state.composeOpen || isTyping(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const index = messages.findIndex((message) => message.id === focusedId);
      const target = state.openId ?? focusedId;

      const move = (delta: number) => {
        if (!messages.length) return;
        const next = Math.min(
          Math.max(index === -1 ? 0 : index + delta, 0),
          messages.length - 1,
        );
        setFocusedId(messages[next].id);
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
          if (focusedId && !state.openId) {
            event.preventDefault();
            state.openMessage(focusedId);
          }
          break;
        case "u":
        case "Escape":
          if (state.openId) state.closeMessage();
          else if (state.searchOpen) state.setSearchOpen(false);
          else if (state.selectedIds.length) state.clearSelection();
          break;
        case "e":
          if (target) {
            event.preventDefault();
            state.archive(
              state.selectedIds.length ? state.selectedIds : [target],
            );
          }
          break;
        case "#":
          if (target) {
            event.preventDefault();
            state.remove(
              state.selectedIds.length ? state.selectedIds : [target],
            );
          }
          break;
        case "s":
          if (target) {
            event.preventDefault();
            state.toggleStar(target);
          }
          break;
        case "x":
          if (focusedId && !state.openId) {
            event.preventDefault();
            state.toggleSelected(focusedId);
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
  }, [messages, focusedId, setFocusedId, store]);
}
