"use client";

import * as React from "react";
import Image from "next/image";
import {
  Image as ImageIcon,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Paperclip,
  Send,
  Trash2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import assistantLogo from "@/public/assitantlogo.png";
import { ClickPowerUp } from "@/components/evil-buttons/click-powerup";
import { useMailStore } from "@/components/mail/mail-store";
import { assistCompose, errorMessage } from "@/lib/mail/client";
import { mailInitials, parseAddressList } from "@/lib/mail/format";
import type { MailDraft } from "@/lib/mail/types";

interface RecipientFieldProps {
  label: string;
  values: string[];
  draft: string;
  onDraftChange: (value: string) => void;
  onCommit: () => void;
  onRemove: (email: string) => void;
  children?: React.ReactNode;
}

/** Chip-based address field — commits on Enter, comma or blur. */
function RecipientField({
  label,
  values,
  draft,
  onDraftChange,
  onCommit,
  onRemove,
  children,
}: RecipientFieldProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="shrink-0 text-[13px] font-medium text-foreground">
          {label}
        </span>
        {values.map((email) => (
          <span
            key={email}
            className="flex h-7 items-center gap-1.5 rounded-md bg-mail-recipient-surface py-1 pl-1.5 pr-2.5"
          >
            <span className="flex size-[18px] items-center justify-center rounded-[4px] bg-mail-recipient/20 text-[8px] font-semibold text-mail-recipient">
              {mailInitials(email)}
            </span>
            <span className="text-[13px] font-medium text-mail-recipient">
              {email}
            </span>
            <button
              type="button"
              aria-label={`Remove ${email}`}
              onClick={() => onRemove(email)}
              className="text-mail-recipient/70 transition-colors hover:text-mail-recipient"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onBlur={onCommit}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              onCommit();
            }
          }}
          aria-label={`${label} recipients`}
          placeholder={values.length ? "" : "name@company.com"}
          className="min-w-[140px] flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        />
      </div>
      {children}
    </div>
  );
}

/**
 * Split a reply draft into the part the user is writing and the quoted
 * original. The quoted block starts with the attribution the reader inserts
 * (`\n\n---\nOn … wrote:`), so the AI can write a reply without clobbering it.
 */
function splitQuoted(body: string): { text: string; quote: string } {
  const marker = "\n\n---\nOn ";
  const index = body.indexOf(marker);
  if (index === -1) return { text: body, quote: "" };
  return { text: body.slice(0, index), quote: body.slice(index) };
}

/**
 * The composer form. Mounted only while the dialog is open, so lazy state
 * initializers seed it from `initial` (a reply/forward draft) — no seeding
 * effect, and each open starts from a clean slate.
 */
function ComposeForm({
  initial,
  onClose,
  onSend,
  onSaveDraft,
}: {
  initial: Partial<MailDraft> | null;
  onClose: () => void;
  onSend: (draft: MailDraft) => Promise<void> | void;
  onSaveDraft: (draft: MailDraft) => Promise<void> | void;
}) {
  const [to, setTo] = React.useState<string[]>(() =>
    parseAddressList(initial?.to ?? ""),
  );
  const [cc, setCc] = React.useState<string[]>(() =>
    parseAddressList(initial?.cc ?? ""),
  );
  const [bcc, setBcc] = React.useState<string[]>(() =>
    parseAddressList(initial?.bcc ?? ""),
  );
  const [toDraft, setToDraft] = React.useState("");
  const [ccDraft, setCcDraft] = React.useState("");
  const [bccDraft, setBccDraft] = React.useState("");
  const [subject, setSubject] = React.useState(initial?.subject ?? "");
  const [body, setBody] = React.useState(initial?.body ?? "");
  const [files, setFiles] = React.useState<string[]>([]);
  const [showCc, setShowCc] = React.useState(Boolean(initial?.cc));
  const [showBcc, setShowBcc] = React.useState(Boolean(initial?.bcc));
  const [expanded, setExpanded] = React.useState(false);
  const [aiDrafted, setAiDrafted] = React.useState(false);
  const [writing, setWriting] = React.useState(false);
  const [draftError, setDraftError] = React.useState<string | null>(null);
  const [aiOpen, setAiOpen] = React.useState(false);
  const [aiPrompt, setAiPrompt] = React.useState("");
  const [assets, setAssets] = React.useState<
    Array<{ id: string; filename: string; kind: string }>
  >([]);
  const [showAssets, setShowAssets] = React.useState(false);
  const [attachedIds, setAttachedIds] = React.useState<string[]>(
    () => initial?.assetIds ?? [],
  );
  const [inlineIds, setInlineIds] = React.useState<string[]>(
    () => initial?.inlineImageIds ?? [],
  );

  React.useEffect(() => {
    let active = true;
    fetch("/api/v1/assets", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { data?: { assets?: Array<{ id: string; filename: string; kind: string }> } }) => {
        if (active && payload.data?.assets) setAssets(payload.data.assets);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const toggleId = (
    id: string,
    setter: React.Dispatch<React.SetStateAction<string[]>>,
  ) =>
    setter((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );

  const commit = (
    draft: string,
    setDraft: (value: string) => void,
    setValues: React.Dispatch<React.SetStateAction<string[]>>,
  ) => {
    const parsed = parseAddressList(draft);
    if (parsed.length) {
      setValues((current) => [...new Set([...current, ...parsed])]);
    }
    setDraft("");
  };

  const asDraft = (): MailDraft => ({
    to: [...to, ...parseAddressList(toDraft)].join(", "),
    cc: [...cc, ...parseAddressList(ccDraft)].join(", "),
    bcc: [...bcc, ...parseAddressList(bccDraft)].join(", "),
    subject,
    body,
    ...(attachedIds.length ? { assetIds: attachedIds } : {}),
    ...(inlineIds.length ? { inlineImageIds: inlineIds } : {}),
  });

  const canSend = to.length > 0 || parseAddressList(toDraft).length > 0;

  /**
   * "Write with AI": the user describes the email or reply, the model streams
   * the body. A quoted reply is preserved and the new text is written above it.
   * Never sends.
   */
  const runAiWrite = async () => {
    if (writing) return;
    const instruction = aiPrompt.trim();
    const { text: existing, quote } = splitQuoted(body);

    setWriting(true);
    setDraftError(null);
    setAiOpen(false);

    let streamed = "";
    try {
      await assistCompose(
        {
          action: "write",
          body: existing,
          ...(instruction ? { instruction } : {}),
          subject,
          to: [...to, ...parseAddressList(toDraft)],
        },
        {
          onChunk: (full) => {
            streamed = full;
            setBody(quote ? `${full}${quote}` : full);
          },
        },
      );
      // A no-op fallback (e.g. no model) leaves the draft untouched.
      if (!streamed) setBody(body);
      else setAiDrafted(true);
    } catch (error) {
      setBody(body);
      setDraftError(errorMessage(error, "The assistant couldn't write that"));
    } finally {
      setWriting(false);
    }
  };

  return (
    /* Deliberately non-modal: no backdrop, no blur — the list stays usable
       behind the composer, the way a real mail client behaves. */
    <div
      role="dialog"
      aria-modal="false"
      aria-label="New message"
      className={cn(
        "absolute z-30 flex flex-col overflow-hidden rounded-xl border border-black/15 bg-card shadow-[0_16px_29px_-9px_rgba(0,0,0,0.16)]",
        expanded
          ? "inset-x-6 top-6 bottom-20 mx-auto w-auto max-w-[1000px]"
          : "bottom-20 right-4 h-[540px] max-h-[calc(100%-6.5rem)] w-[560px] max-w-[calc(100%-2rem)]",
      )}
    >
      <header className="flex h-11 shrink-0 items-center justify-between bg-mail-compose-chrome py-3 pl-5 pr-3">
        <h2 className="text-[14px] font-medium text-foreground">New message</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? "Collapse composer" : "Expand composer"}
            aria-pressed={expanded}
            className="text-foreground/70 transition-colors hover:text-foreground"
          >
            {expanded ? (
              <Minimize2 className="size-4" aria-hidden />
            ) : (
              <Maximize2 className="size-4" aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close composer"
            className="text-foreground/70 transition-colors hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </header>

      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          // Without this a stray Enter in any field reloads the page.
          event.preventDefault();
          if (canSend) onSend(asDraft());
        }}
      >
        <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-4">
          <div className="flex flex-col gap-2.5">
            <RecipientField
              label="To"
              values={to}
              draft={toDraft}
              onDraftChange={setToDraft}
              onCommit={() => commit(toDraft, setToDraft, setTo)}
              onRemove={(email) =>
                setTo((current) => current.filter((value) => value !== email))
              }
            >
              <div className="flex shrink-0 items-center gap-2.5 text-[13px] font-medium">
                {!showCc && (
                  <button
                    type="button"
                    onClick={() => setShowCc(true)}
                    className="text-foreground transition-colors hover:text-mail-recipient"
                  >
                    Cc
                  </button>
                )}
                {!showBcc && (
                  <button
                    type="button"
                    onClick={() => setShowBcc(true)}
                    className="text-foreground transition-colors hover:text-mail-recipient"
                  >
                    Bcc
                  </button>
                )}
              </div>
            </RecipientField>

            {showCc && (
              <RecipientField
                label="Cc"
                values={cc}
                draft={ccDraft}
                onDraftChange={setCcDraft}
                onCommit={() => commit(ccDraft, setCcDraft, setCc)}
                onRemove={(email) =>
                  setCc((current) => current.filter((value) => value !== email))
                }
              />
            )}
            {showBcc && (
              <RecipientField
                label="Bcc"
                values={bcc}
                draft={bccDraft}
                onDraftChange={setBccDraft}
                onCommit={() => commit(bccDraft, setBccDraft, setBcc)}
                onRemove={(email) =>
                  setBcc((current) =>
                    current.filter((value) => value !== email),
                  )
                }
              />
            )}
          </div>

          <hr className="border-t border-border" />

          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Subject"
            aria-label="Subject"
            className="w-full bg-transparent text-[16px] font-semibold text-foreground outline-none placeholder:text-muted-foreground/60"
          />

          {draftError && (
            <p role="alert" className="text-[12px] text-destructive">
              {draftError}
            </p>
          )}

          {/* Unframed by default; the gradient frame is the AI-drafted state. */}
          <div
            className={cn(
              "flex min-h-[200px] flex-1 flex-col rounded-lg",
              aiDrafted && "surface-ai-gradient p-0.5",
            )}
          >
            <div
              className={cn(
                "relative flex min-h-0 flex-1 flex-col",
                aiDrafted && "rounded-[6px] bg-card",
              )}
            >
              <textarea
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                  // Editing an AI draft is still approving it; only clearing
                  // the body puts the composer back to a blank slate.
                  if (aiDrafted && !event.target.value.trim()) {
                    setAiDrafted(false);
                  }
                }}
                placeholder="Write your message…"
                aria-label="Message body"
                className="scrollbar-none min-h-[190px] w-full flex-1 resize-none bg-transparent py-1 text-[13px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

        </div>

        {/* Always-visible AI action, kept out of the scroll area. */}
        <div className="shrink-0 px-5 pt-1 pb-2">
          <ClickPowerUp
            plain
            onClick={() => setAiOpen((value) => !value)}
            disabled={writing}
            aria-expanded={aiOpen}
            aria-controls="compose-ai-prompt"
            accentColor="#8a43e1"
            className="self-start rounded-md px-3 py-1.5 text-[12px] tracking-normal normal-case"
          >
            {writing ? (
              <span className="flex items-center gap-2">
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                Writing…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Image
                  src={assistantLogo}
                  alt=""
                  width={16}
                  height={16}
                  className="size-4 shrink-0 object-contain"
                />
                Write with AI
              </span>
            )}
          </ClickPowerUp>

          {aiOpen && !writing && (
            <div
              id="compose-ai-prompt"
              className="mt-2 rounded-lg border border-border bg-secondary/40 p-3"
            >
              <label
                htmlFor="compose-ai-prompt-input"
                className="text-[12px] font-medium text-foreground"
              >
                Describe the email or reply
              </label>
              <textarea
                id="compose-ai-prompt-input"
                autoFocus
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void runAiWrite();
                  }
                  if (event.key === "Escape") setAiOpen(false);
                }}
                placeholder="e.g. Reply to Sarah thanking her and confirming Tuesday at 3pm."
                aria-label="Describe the email or reply"
                className="mt-2 min-h-[56px] w-full resize-none rounded-md border border-border bg-card p-2 text-[13px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  Enter to write · Shift+Enter for a new line
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAiOpen(false)}
                    className="h-8 rounded-lg px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAiWrite()}
                    disabled={writing}
                    className="h-8 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-opacity disabled:opacity-50"
                  >
                    Generate
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {files.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-2 px-5 pb-2">
            {files.map((name, index) => (
              <span
                key={`${name}-${index}`}
                className="flex items-center gap-1.5 rounded-md bg-mail-chip px-2 py-1 text-[12px] text-mail-chip-foreground"
              >
                {name}
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() =>
                    setFiles((current) =>
                      current.filter((_, position) => position !== index),
                    )
                  }
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}

        {(attachedIds.length > 0 || inlineIds.length > 0) && (
          <div className="flex shrink-0 flex-wrap gap-2 px-5 pb-2">
            {assets
              .filter((asset) => attachedIds.includes(asset.id))
              .map((asset) => (
                <span
                  key={`attached-${asset.id}`}
                  className="flex items-center gap-1.5 rounded-md bg-mail-chip px-2 py-1 text-[12px] text-mail-chip-foreground"
                >
                  <Paperclip className="size-3" aria-hidden />
                  {asset.filename}
                  <button
                    type="button"
                    aria-label={`Remove ${asset.filename}`}
                    onClick={() => toggleId(asset.id, setAttachedIds)}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
            {assets
              .filter((asset) => inlineIds.includes(asset.id))
              .map((asset) => (
                <span
                  key={`inline-${asset.id}`}
                  className="flex items-center gap-1.5 rounded-md bg-mail-chip px-2 py-1 text-[12px] text-mail-chip-foreground"
                >
                  <ImageIcon className="size-3" aria-hidden />
                  Inline: {asset.filename}
                  <button
                    type="button"
                    aria-label={`Remove inline ${asset.filename}`}
                    onClick={() => toggleId(asset.id, setInlineIds)}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
          </div>
        )}

        {showAssets ? (
          <div className="absolute bottom-16 left-5 right-5 z-40 max-h-64 overflow-y-auto rounded-lg border border-border bg-card p-2 shadow-lg">
            {assets.length === 0 ? (
              <p className="p-2 text-[12px] text-muted-foreground">
                No assets yet. Add images or files in Settings → Assets.
              </p>
            ) : (
              <ul className="flex flex-col">
                {assets.map((asset) => {
                  const attached = attachedIds.includes(asset.id);
                  const inline = inlineIds.includes(asset.id);
                  return (
                    <li
                      key={asset.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent"
                    >
                      <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                        {asset.filename}
                      </span>
                      {asset.kind === "image" ? (
                        <button
                          type="button"
                          onClick={() => toggleId(asset.id, setInlineIds)}
                          className={cn(
                            "rounded-md border border-border px-2 py-0.5 text-[11px]",
                            inline && "border-mail-recipient text-mail-recipient",
                          )}
                        >
                          {inline ? "Inline ✓" : "Inline"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => toggleId(asset.id, setAttachedIds)}
                        className={cn(
                          "rounded-md border border-border px-2 py-0.5 text-[11px]",
                          attached && "border-mail-recipient text-mail-recipient",
                        )}
                      >
                        {attached ? "Attached ✓" : "Attach"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-black/10 bg-mail-compose-chrome px-5 py-3">
          <div className="flex items-center gap-1.5">
            <button
              type="submit"
              disabled={!canSend}
              className={cn(
                "flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-[13px] font-medium transition-opacity disabled:opacity-50",
                aiDrafted
                  ? "surface-ai-gradient text-white"
                  : "bg-primary text-primary-foreground",
              )}
            >
              {!aiDrafted && <Send className="size-4" aria-hidden />}
              {aiDrafted ? "Approve & Send" : "Send"}
            </button>

            <label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-accent">
              <Paperclip className="size-4" aria-hidden />
              Attach a file
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  const names = Array.from(event.target.files ?? []).map(
                    (file) => file.name,
                  );
                  setFiles((current) => [...current, ...names]);
                  event.target.value = "";
                }}
              />
            </label>

            <button
              type="button"
              onClick={() => setShowAssets((value) => !value)}
              aria-pressed={showAssets}
              className={cn(
                "flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-accent",
                showAssets && "bg-accent",
              )}
            >
              <ImageIcon className="size-4" aria-hidden />
              Assets
            </button>

            <button
              type="button"
              onClick={() => onSaveDraft(asDraft())}
              className="h-9 rounded-lg px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-accent"
            >
              Save draft
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Discard draft"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </footer>
      </form>
    </div>
  );
}

export function ComposeDialog() {
  const open = useMailStore((state) => state.composeOpen);
  const initial = useMailStore((state) => state.composeInitial);
  const closeCompose = useMailStore((state) => state.closeCompose);
  const send = useMailStore((state) => state.send);
  const saveDraft = useMailStore((state) => state.saveDraft);

  if (!open) return null;

  return (
    <ComposeForm
      initial={initial}
      onClose={closeCompose}
      onSend={send}
      onSaveDraft={saveDraft}
    />
  );
}
