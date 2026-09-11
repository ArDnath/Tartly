"use client";

import { X } from "lucide-react";

import { useAiChat } from "@/components/ai-chat/ai-chat-provider";
import { Button } from "@/components/ui/button";

/** Messages typed while a reply is streaming, sent automatically afterwards. */
export const AiChatQueuedMessages = () => {
  const { queuedMessages, removeQueuedMessage } = useAiChat();

  if (queuedMessages.length === 0) {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-[768px] shrink-0 px-3">
      <p className="px-1 pb-1 text-xs text-muted-foreground">
        {queuedMessages.length} queued
      </p>
      <div className="flex flex-col gap-1">
        {queuedMessages.map((message) => (
          <div
            key={message.id}
            className="flex items-center justify-between gap-2 rounded-md bg-secondary px-2 py-1.5 text-sm text-secondary-foreground"
          >
            <span className="truncate">{message.text}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Remove queued message"
              onClick={() => removeQueuedMessage(message.id)}
            >
              <X className="size-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};
