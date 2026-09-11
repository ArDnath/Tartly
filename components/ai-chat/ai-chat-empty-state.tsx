"use client";

import { Sparkles } from "lucide-react";

import { AI_CHAT_SUGGESTED_PROMPTS } from "@/lib/ai/suggested-prompts";

/** Empty-state starter prompts. Clicking one prefills the composer. */
export const AiChatEmptyState = ({
  onPick,
}: {
  onPick: (prompt: string) => void;
}) => (
  <div className="flex flex-col items-center gap-4 px-2 pb-2 text-center">
    <div className="flex flex-col items-center gap-1">
      <span className="flex size-11 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <Sparkles className="size-5" />
      </span>
      <h2 className="text-lg font-semibold text-foreground">
        What can I help you with?
      </h2>
    </div>
    <div className="flex flex-wrap justify-center gap-2">
      {AI_CHAT_SUGGESTED_PROMPTS.map((suggested) => (
        <button
          key={suggested.id}
          type="button"
          onClick={() => onPick(suggested.prompt)}
          className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {suggested.label}
        </button>
      ))}
    </div>
  </div>
);
