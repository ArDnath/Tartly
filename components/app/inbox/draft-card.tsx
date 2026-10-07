"use client";

import { Loader2, Send, Sparkles, Trash2 } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function DraftCard({
  draft,
  recipient,
  isBusy,
  onApprove,
  onDiscard,
  onRegenerate,
}: {
  draft: { id: string; body: string; editedBody: string | null };
  recipient?: string | null;
  isBusy: boolean;
  onApprove: (body: string) => void;
  onDiscard: () => void;
  onRegenerate: () => void;
}) {
  // The parent keys this component on the draft body, so a regenerated draft
  // remounts with the new text instead of needing a prop-sync effect.
  const [body, setBody] = useState(draft.editedBody ?? draft.body);
  const canSend = body.trim().length > 0 && !isBusy;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSend) {
      event.preventDefault();
      onApprove(body);
    }
  };

  return (
    <section className="shrink-0 border-t border-border bg-card px-5 py-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-foreground/80">
              Draft reply
            </span>
            {recipient ? (
              <span className="truncate text-[11px] text-muted-foreground">
                to {recipient}
              </span>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onRegenerate}
            disabled={isBusy}
            className="shrink-0 gap-1 text-muted-foreground"
          >
            {isBusy ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Sparkles className="size-3" />
            )}
            Regenerate
          </Button>
        </div>

        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={6}
          className="resize-none bg-canvas text-[13.5px] leading-relaxed"
        />

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDiscard}
            disabled={isBusy}
            className="gap-1.5 text-muted-foreground"
          >
            <Trash2 className="size-3.5" />
            Discard
          </Button>

          <div className="flex items-center gap-3">
            <span className="hidden text-[10px] uppercase tracking-wider text-muted-foreground sm:block">
              ⌘↵ to send
            </span>
            <Button
              type="button"
              size="sm"
              onClick={() => onApprove(body)}
              disabled={!canSend}
              className="gap-1.5"
            >
              {isBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              Send
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
