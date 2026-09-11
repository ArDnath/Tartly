"use client";

import { Check, Copy, Loader2 } from "lucide-react";
import { useState } from "react";

import { MessageResponse } from "@/components/ai-elements/message";
import { formatRelativeTime } from "@/components/ai-chat/format-relative-time";
import type { ChatMessage } from "@/lib/ai/chat-types";
import { cn } from "@/lib/utils";

export const AiChatMessage = ({
  message,
  isStreaming,
}: {
  message: ChatMessage;
  isStreaming: boolean;
}) => {
  const [hasCopied, setHasCopied] = useState(false);
  const isUser = message.role === "user";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 1200);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <div
      className={cn(
        "group flex w-full flex-col gap-1",
        isUser ? "items-end" : "items-start",
      )}
    >
      {isUser ? (
        <div className="max-w-[85%] break-words rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-foreground">
          <span className="whitespace-pre-wrap">{message.text}</span>
        </div>
      ) : (
        <div className="w-full min-w-0 text-sm text-foreground">
          {message.text ? (
            <MessageResponse
              isAnimating={isStreaming}
              className="ai-chat-markdown"
            >
              {message.text}
            </MessageResponse>
          ) : (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Thinking…
            </span>
          )}
        </div>
      )}

      {message.text ? (
        <div className="flex w-full items-center gap-2 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          <span>{formatRelativeTime(message.createdAt)}</span>
          <button
            type="button"
            onClick={copy}
            aria-label="Copy message"
            className="inline-flex items-center hover:text-foreground"
          >
            {hasCopied ? (
              <Check className="size-3" />
            ) : (
              <Copy className="size-3" />
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
};
