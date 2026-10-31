"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  type UIMessage,
} from "ai";
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
import { TartlyAgentLogo } from "@/components/shared/brand/tartly-logo";
import { ClickPowerUp } from "@/components/shared/evil-buttons/click-powerup";
import { useMailStore } from "@/components/app/mail/mail-store";
import {
  openPaywall,
  usePaywallStore,
} from "@/components/app/paywall/paywall-store";
import { MAX_OUTBOUND_ASSETS } from "@/lib/assets/limits";
import { uploadAsset } from "@/lib/assets/client";
import { mailInitials, parseAddressList } from "@/lib/mail/format";
import type { MailDraft, MailSourceAttachment } from "@/lib/mail/types";
import type { ComposerDraft } from "@/lib/agent/tools/deliver-composer-draft";

/**
 * The agent's live thinking surface, loaded on demand so the AI Elements stack
 * (and every artifact card it pulls in) stays out of the mail route's initial JS
 * until the user actually asks the composer agent to write.
 */
const ComposeAgentThread = dynamic(
  () =>
    import("@/components/app/mail/compose-agent-thread").then(
      (module) => module.ComposeAgentThread,
    ),
  { ssr: false },
);

const DELIVER_TOOL_NAME = "deliver_composer_draft";

/** Concatenated text parts of a message (the UI has no other text source). */
function messageText(message: UIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

/** Validate the `deliver_composer_draft` tool output into a draft. */
function readDraft(output: unknown): ComposerDraft | null {
  if (!output || typeof output !== "object") return null;
  const value = output as Record<string, unknown>;
  const body = typeof value.body === "string" ? value.body : "";
  if (!body.trim()) return null;
  const list = (input: unknown): string[] =>
    Array.isArray(input)
      ? input.filter((item): item is string => typeof item === "string")
      : [];
  return {
    to: list(value.to),
    cc: list(value.cc),
    bcc: list(value.bcc),
    subject: typeof value.subject === "string" ? value.subject : "",
    body,
  };
}

/** The finished draft, once the agent has delivered it on the stream. */
function findComposeDraft(messages: UIMessage[]): ComposerDraft | null {
  for (const message of messages) {
    for (const part of message.parts) {
      if (
        isToolUIPart(part) &&
        getToolName(part) === DELIVER_TOOL_NAME &&
        part.state === "output-available"
      ) {
        const draft = readDraft(part.output);
        if (draft) return draft;
      }
    }
  }
  return null;
}

/** A clean message from a `useChat` error, whose body may be a JSON envelope. */
function readAiError(error: Error | undefined): string {
  if (!error?.message) return "The assistant couldn't write that";
  try {
    const payload = JSON.parse(error.message) as {
      error?: { message?: string };
    };
    if (payload.error?.message) return payload.error.message;
  } catch {
    // Not a JSON envelope — fall through to the raw message.
  }
  return error.message;
}


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
  const accounts = useMailStore((state) => state.accounts);
  const liveAccounts = accounts.filter(
    (account) => account.connected && account.mailboxAccess,
  );
  const gmailLive = liveAccounts.some((account) => account.provider === "gmail");
  const outlookLive = liveAccounts.some(
    (account) => account.provider === "outlook",
  );
  const [account, setAccount] = React.useState<"gmail" | "outlook">(
    () =>
      initial?.account ??
      (gmailLive || !outlookLive ? "gmail" : "outlook"),
  );

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
  /**
   * Files kept on the original message when forwarding. They are imported into
   * the asset library only on send/save, so opening a forward and discarding it
   * does not copy anything into storage.
   */
  const [sourceAttachments, setSourceAttachments] = React.useState<
    MailSourceAttachment[]
  >(() => initial?.sourceAttachments ?? []);
  const [uploading, setUploading] = React.useState(0);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [assetsEnabled, setAssetsEnabled] = React.useState(true);
  const [showCc, setShowCc] = React.useState(Boolean(initial?.cc));
  const [showBcc, setShowBcc] = React.useState(Boolean(initial?.bcc));
  const [expanded, setExpanded] = React.useState(false);
  const [aiDrafted, setAiDrafted] = React.useState(false);
  const [aiRunning, setAiRunning] = React.useState(false);
  const [draftError, setDraftError] = React.useState<string | null>(null);
  const [aiOpen, setAiOpen] = React.useState(false);
  const [aiPrompt, setAiPrompt] = React.useState("");
  /**
   * The quoted original captured at send time. The agent only ever writes the
   * new text, so the quote is re-appended when its draft arrives.
   */
  const quoteRef = React.useRef("");

  const aiTransport = React.useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/v1/mail/compose",
        prepareSendMessagesRequest: ({ messages, body }) => {
          const lastUser = [...messages]
            .reverse()
            .find((message) => message.role === "user");
          return {
            body: { ...(body ?? {}), text: messageText(lastUser) },
          };
        },
      }),
    [],
  );

  const {
    messages: streamedMessages,
    sendMessage,
    setMessages: setStreamedMessages,
    status: aiStatus,
  } = useChat({
    transport: aiTransport,
    onFinish: ({ messages, isError, isAbort }) => {
      const draft = findComposeDraft(messages);
      if (draft) {
        applyComposeDraft(draft);
        return;
      }
      if (isError || isAbort) return;
      setDraftError("The assistant couldn't finish that draft. Please try again.");
      setAiRunning(false);
      setStreamedMessages([]);
    },
    onError: (error) => {
      if (String(error?.message ?? "").includes("payment_required")) {
        openPaywall("ai");
        setAiRunning(false);
        setStreamedMessages([]);
        return;
      }
      setDraftError(readAiError(error));
      setAiRunning(false);
      setStreamedMessages([]);
    },
  });

  const [assets, setAssets] = React.useState<
    Array<{ id: string; filename: string; kind: string; mimeType?: string }>
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
      .then((payload: {
        data?: {
          assets?: Array<{
            id: string;
            filename: string;
            kind: string;
            mimeType?: string;
          }>;
          enabled?: boolean;
        };
      }) => {
        if (!active || !payload.data) return;
        if (payload.data.assets) setAssets(payload.data.assets);
        if (typeof payload.data.enabled === "boolean") {
          setAssetsEnabled(payload.data.enabled);
        }
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

  /**
   * An asset is either an attachment or an inline image, never both. Moving it
   * between the two lists keeps the chips truthful and avoids a duplicate MIME
   * part on the wire.
   */
  const togglePlacement = (id: string, target: "attach" | "inline") => {
    if (target === "attach") {
      setInlineIds((current) => current.filter((value) => value !== id));
      toggleId(id, setAttachedIds);
    } else {
      setAttachedIds((current) => current.filter((value) => value !== id));
      toggleId(id, setInlineIds);
    }
  };

  /**
   * Upload selected files through the same ticket-based asset flow as Settings
   * → Assets and the chat composer. The composer only ever holds asset ids; the
   * bytes go straight to storage and are scanned by the server.
   */
  const uploadFiles = async (selected: FileList) => {
    const files = Array.from(selected);
    if (files.length === 0) return;

    const capacity = Math.max(
      0,
      MAX_OUTBOUND_ASSETS -
        attachedIds.length -
        inlineIds.length -
        sourceAttachments.length,
    );
    if (capacity === 0) {
      setUploadError(
        `A message can carry at most ${MAX_OUTBOUND_ASSETS} files. Remove one before adding another.`,
      );
      return;
    }

    const accepted = files.slice(0, capacity);
    if (files.length > capacity) {
      setUploadError(
        `Only ${capacity} more file${capacity === 1 ? "" : "s"} can be added to this message.`,
      );
    } else {
      setUploadError(null);
    }

    setUploading((count) => count + accepted.length);
    for (const file of accepted) {
      try {
        const asset = await uploadAsset({
          blob: file,
          filename: file.name || "file",
          mimeType: file.type,
        });
        setAssets((current) =>
          current.some((item) => item.id === asset.id)
            ? current
            : [
                {
                  id: asset.id,
                  filename: asset.filename,
                  kind: asset.kind,
                  mimeType: asset.mimeType,
                },
                ...current,
              ],
        );
        // Images default to attachments, matching a paperclip; the Assets
        // picker can promote one to an inline image afterwards.
        setAttachedIds((current) =>
          current.includes(asset.id) ? current : [...current, asset.id],
        );
      } catch (caught) {
        setUploadError(
          caught instanceof Error
            ? caught.message
            : `Couldn't upload ${file.name}.`,
        );
      } finally {
        setUploading((count) => count - 1);
      }
    }
  };

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
    ...(sourceAttachments.length
      ? { sourceAttachments }
      : {}),
    // Preserve the reply context seeded when the composer opened, so an
    // Outlook reply is still sent from Outlook rather than defaulting to Gmail.
    account,
    ...(initial?.threadId ? { threadId: initial.threadId } : {}),
  });

  const canSend =
    (to.length > 0 || parseAddressList(toDraft).length > 0) && uploading === 0;

  /** Fill the form from the agent's delivered draft and close the thread. */
  function applyComposeDraft(draft: ComposerDraft) {
    if (draft.to.length) {
      setTo((current) => [...new Set([...current, ...draft.to])]);
    }
    if (draft.cc.length) {
      setCc((current) => [...new Set([...current, ...draft.cc])]);
      setShowCc(true);
    }
    if (draft.bcc.length) {
      setBcc((current) => [...new Set([...current, ...draft.bcc])]);
      setShowBcc(true);
    }
    setSubject((current) => (current.trim() ? current : draft.subject));
    setBody(quoteRef.current ? `${draft.body}${quoteRef.current}` : draft.body);
    setAiDrafted(true);
    setAiRunning(false);
    setStreamedMessages([]);
  }

  /**
   * "Write with AI": the same agent runtime and stream as the assistant space.
   * The agent searches contacts and the mailbox to find the recipient, then
   * calls `deliver_composer_draft`. We render its live thinking/tool steps in
   * the body area and, the moment the draft arrives, replace that thread with
   * the finished To/subject/body. A quoted reply is preserved. Never sends.
   */
  const runAiWrite = () => {
    if (aiRunning) return;
    // Writing a draft is an AI action; free users get the wall, not a request.
    const entitlement = usePaywallStore.getState().entitlement;
    if (entitlement && !entitlement.isSubscriber) {
      openPaywall("ai");
      return;
    }
    const instruction =
      aiPrompt.trim() || "Write a fitting email for me.";
    const { text: existing, quote } = splitQuoted(body);
    quoteRef.current = quote;

    setAiRunning(true);
    setAiDrafted(false);
    setDraftError(null);
    setAiOpen(false);
    setStreamedMessages([]);

    void sendMessage(
      { text: instruction },
      {
        body: {
          compose: {
            to: [...to, ...parseAddressList(toDraft)],
            cc: [...cc, ...parseAddressList(ccDraft)],
            bcc: [...bcc, ...parseAddressList(bccDraft)],
            subject,
            body: existing,
          },
        },
      },
    );
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
            {gmailLive && outlookLive ? (
              <div className="flex items-center gap-3">
                <span className="shrink-0 text-[13px] font-medium text-foreground">
                  From
                </span>
                <select
                  value={account}
                  onChange={(event) =>
                    setAccount(event.target.value as "gmail" | "outlook")
                  }
                  aria-label="Send from account"
                  className="h-8 rounded-md border border-border bg-card px-2 text-[13px] text-foreground outline-none"
                >
                  <option value="gmail">
                    {liveAccounts.find((item) => item.provider === "gmail")
                      ?.email ?? "Gmail"}
                  </option>
                  <option value="outlook">
                    {liveAccounts.find((item) => item.provider === "outlook")
                      ?.email ?? "Outlook"}
                  </option>
                </select>
              </div>
            ) : null}

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

          {/* The body area is the agent's live thinking thread while it works,
              otherwise the plain textarea. The framed box appears only with the
              AI — before that the body is unframed. */}
          {aiRunning ? (
            <div className="flex min-h-[200px] flex-1 flex-col overflow-hidden rounded-none border border-mail-recipient/50 bg-card">
              <ComposeAgentThread messages={streamedMessages} status={aiStatus} />
            </div>
          ) : (
            <div
              className={cn(
                "flex min-h-[200px] flex-1 flex-col rounded-none",
                aiDrafted && "border border-mail-recipient/50 bg-card",
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
                className={cn(
                  "scrollbar-none min-h-[190px] w-full flex-1 resize-none bg-transparent text-[13px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground",
                  aiDrafted ? "px-4 py-3" : "py-1",
                )}
              />
            </div>
          )}

        </div>

        {/* Always-visible AI action, kept out of the scroll area. */}
        <div className="shrink-0 px-5 pt-1 pb-2">
          <ClickPowerUp
            plain
            onClick={() => setAiOpen((value) => !value)}
            disabled={aiRunning}
            aria-expanded={aiOpen}
            aria-controls="compose-ai-prompt"
            accentColor="var(--mail-recipient)"
            className="self-start rounded-md px-3 py-1.5 text-[12px] tracking-normal normal-case"
          >
            {aiRunning ? (
              <span className="flex items-center gap-2">
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                Writing…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <TartlyAgentLogo className="size-4 shrink-0" />
                Write with AI
              </span>
            )}
          </ClickPowerUp>

          {aiOpen && !aiRunning && (
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
                    runAiWrite();
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
                    onClick={() => runAiWrite()}
                    disabled={aiRunning}
                    className="h-8 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-opacity disabled:opacity-50"
                  >
                    Generate
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {sourceAttachments.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-2 px-5 pb-2">
            {sourceAttachments.map((attachment) => (
              <span
                key={`${attachment.messageId}:${attachment.attachmentId}`}
                className="flex items-center gap-1.5 rounded-md bg-mail-chip px-2 py-1 text-[12px] text-mail-chip-foreground"
              >
                <Paperclip className="size-3" aria-hidden />
                {attachment.filename}
                <button
                  type="button"
                  aria-label={`Remove ${attachment.filename}`}
                  onClick={() =>
                    setSourceAttachments((current) =>
                      current.filter(
                        (item) =>
                          item.messageId !== attachment.messageId ||
                          item.attachmentId !== attachment.attachmentId,
                      ),
                    )
                  }
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}

        {(uploading > 0 || uploadError) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pb-2">
            {uploading > 0 ? (
              <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <LoaderCircle className="size-3 animate-spin" aria-hidden />
                Uploading {uploading} file{uploading === 1 ? "" : "s"}…
              </span>
            ) : null}
            {uploadError ? (
              <p role="alert" className="text-[12px] text-destructive">
                {uploadError}
              </p>
            ) : null}
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
                          onClick={() => togglePlacement(asset.id, "inline")}
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
                        onClick={() => togglePlacement(asset.id, "attach")}
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
            {aiDrafted ? (
              /* Approving an AI draft is the primary action here, so it gets the
                 same powered-up treatment as "Write with AI" — larger, and in
                 palette colours rather than the old gradient. */
              <ClickPowerUp
                type="submit"
                disabled={!canSend}
                plain
                accentColor="var(--mail-recipient)"
                className="h-10 rounded-md px-5 py-2.5 text-[13px] tracking-normal normal-case"
              >
                <span className="flex items-center gap-2">
                  <Send className="size-4" aria-hidden />
                  Approve &amp; Send
                </span>
              </ClickPowerUp>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                className="flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-opacity disabled:opacity-50"
              >
                <Send className="size-4" aria-hidden />
                Send
              </button>
            )}

            <label
              title={
                assetsEnabled
                  ? "Upload a PDF or image"
                  : "Attachments are unavailable in this workspace"
              }
              className={cn(
                "flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-medium text-foreground transition-colors",
                assetsEnabled && uploading === 0
                  ? "cursor-pointer hover:bg-accent"
                  : "cursor-not-allowed opacity-50",
              )}
            >
              {uploading > 0 ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : (
                <Paperclip className="size-4" aria-hidden />
              )}
              {uploading > 0 ? "Uploading…" : "Attach a file"}
              <input
                type="file"
                multiple
                disabled={!assetsEnabled || uploading > 0}
                className="hidden"
                onChange={(event) => {
                  if (event.target.files?.length) {
                    void uploadFiles(event.target.files);
                  }
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
              disabled={uploading > 0}
              className="h-9 rounded-lg px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
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
