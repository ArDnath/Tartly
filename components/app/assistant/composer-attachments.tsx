"use client";

import type { ChatStatus } from "ai";
import { FileTextIcon, ImageIcon, Loader2Icon, PlusIcon, XIcon } from "lucide-react";

import {
  PromptInputButton,
  PromptInputHeader,
  PromptInputSubmit,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { cn } from "@/lib/utils";

/**
 * The composer's "+" control and the chips for files staged on this turn.
 *
 * Both live *inside* `<PromptInput>` so they share its hidden file input. That
 * gives us drag-and-drop, paste-to-attach and the same accept/size limits for
 * free; the chat surface only has to upload the staged files on submit.
 */
export function ComposerAttachButton({
  disabled,
  onUnavailable,
}: {
  disabled?: boolean;
  onUnavailable?: () => void;
}) {
  const { openFileDialog } = usePromptInputAttachments();

  return (
    <PromptInputButton
      aria-label="Attach a PDF or image"
      tooltip={
        disabled
          ? "Attachments are unavailable in this workspace"
          : "Attach a PDF, image, or text file"
      }
      disabled={disabled}
      onClick={() => {
        if (disabled) {
          onUnavailable?.();
          return;
        }
        openFileDialog();
      }}
    >
      <PlusIcon className="size-4" aria-hidden />
    </PromptInputButton>
  );
}

function extensionLabel(filename: string, mimeType: string): string {
  const extension = filename.split(".").pop()?.toUpperCase();
  if (extension && extension.length <= 5) return extension;
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return "IMAGE";
  return "FILE";
}

/**
 * Send button that also knows whether files are staged. A file-only turn is a
 * valid request, so the button must not stay disabled just because the textarea
 * is empty.
 */
export function ComposerSubmit({
  status,
  onStop,
  hasText,
  uploading,
}: {
  status: ChatStatus;
  onStop: () => void;
  hasText: boolean;
  uploading: boolean;
}) {
  const { files } = usePromptInputAttachments();
  const isGenerating = status === "submitted" || status === "streaming";

  return (
    <PromptInputSubmit
      status={status}
      onStop={onStop}
      disabled={
        !isGenerating && (uploading || (!hasText && files.length === 0))
      }
    />
  );
}

/** Files staged for the next turn, with a remove action for each. */
export function ComposerAttachments({ busy }: { busy: boolean }) {
  const { files, remove } = usePromptInputAttachments();

  if (files.length === 0) return null;

  return (
    <PromptInputHeader className="gap-2">
      {files.map((file) => {
        const isImage = file.mediaType.startsWith("image/");
        return (
          <div
            key={file.id}
            className={cn(
              "flex max-w-full items-center gap-2 rounded-md border border-border bg-background/80 py-1 pr-1 pl-1.5",
              busy && "opacity-70",
            )}
          >
            <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
              {isImage && file.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={file.url}
                  alt=""
                  className="size-full object-cover"
                  aria-hidden
                />
              ) : isImage ? (
                <ImageIcon className="size-3.5 text-muted-foreground" aria-hidden />
              ) : (
                <FileTextIcon className="size-3.5 text-muted-foreground" aria-hidden />
              )}
            </span>
            <span className="min-w-0">
              <span className="block max-w-40 truncate text-[11px] font-medium text-foreground">
                {file.filename ?? "File"}
              </span>
              <span className="block text-[9px] text-muted-foreground">
                {extensionLabel(file.filename ?? "", file.mediaType)}
                {busy ? " · uploading…" : ""}
              </span>
            </span>
            {busy ? (
              <Loader2Icon className="size-3 animate-spin text-muted-foreground" aria-hidden />
            ) : (
              <button
                type="button"
                aria-label={`Remove ${file.filename ?? "attachment"}`}
                onClick={() => remove(file.id)}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <XIcon className="size-3" aria-hidden />
              </button>
            )}
          </div>
        );
      })}
    </PromptInputHeader>
  );
}
