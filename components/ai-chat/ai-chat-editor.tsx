"use client";

import { Loader2, Send, Square } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";

import { AiChatEmptyState } from "@/components/ai-chat/ai-chat-empty-state";
import { useAiChat } from "@/components/ai-chat/ai-chat-provider";
import { Button } from "@/components/ui/button";

const MAX_TEXTAREA_HEIGHT_PX = 240;

export const AiChatEditor = () => {
  const {
    draft,
    setDraft,
    send,
    stop,
    isStreaming,
    isStartingThread,
    messages,
  } = useAiChat();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isBusy = isStreaming || isStartingThread;
  const canSend = draft.trim().length > 0 && !isBusy;
  const showEmptyState = messages.length === 0 && !isBusy;

  // Auto-grow the composer with its content.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(
      textarea.scrollHeight,
      MAX_TEXTAREA_HEIGHT_PX,
    )}px`;
  }, [draft]);

  const submit = () => {
    if (!canSend) return;
    void send(draft);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[768px] shrink-0 flex-col gap-3 p-3">
      {showEmptyState ? (
        <AiChatEmptyState
          onPick={(prompt) => {
            setDraft(prompt);
            textareaRef.current?.focus();
          }}
        />
      ) : null}

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2 transition-colors focus-within:border-ring">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Send a message…"
          disabled={isStartingThread}
          className="max-h-60 min-h-9 w-full resize-none bg-transparent px-1 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />
        <div className="flex items-center justify-between">
          <span className="px-1 text-xs text-muted-foreground">
            Enter to send · Shift+Enter for a new line
          </span>
          {isStreaming ? (
            <Button type="button" variant="outline" size="sm" onClick={stop}>
              <Square className="size-5" />
              Stop
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              aria-label="Send message"
              disabled={!canSend}
              onClick={submit}
            >
              {isStartingThread ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Send className="size-5" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
