"use client";

import * as React from "react";
import {
  Archive,
  ArrowLeft,
  BellOff,
  ChevronDown,
  ClockFading,
  Forward,
  Loader2,
  Mail,
  Paperclip,
  Printer,
  Reply,
  ReplyAll,
  Star,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMailStore } from "@/components/app/mail/mail-store";
import { formatMailFullDate, mailInitials } from "@/lib/mail/format";
import { isTrashView } from "@/lib/mail/filter";
import { LabelAction } from "@/components/app/mail/mail-toolbar";
import { MailTagBadge } from "@/components/app/mail/mail-tag-badge";
import { MailHtmlBody } from "@/components/app/mail/mail-html-body";
import type { MailMessage, MailSourceAttachment } from "@/lib/mail/types";

function ReaderAction({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className="flex size-8 items-center justify-center rounded-lg text-mail-muted transition-colors hover:bg-mail-row-hover hover:text-mail-strong"
          >
            <Icon className="size-[18px]" aria-hidden />
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function quoted(message: MailMessage): string {
  return `\n\n---\nOn ${formatMailFullDate(message.receivedAt)}, ${message.from.name} <${message.from.email}> wrote:\n${message.body
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}`;
}

/**
 * Forwarding carries the original files. They stay provider references until
 * the composer sends/saves, when the store imports them into the asset library
 * (owner-scoped, scanned, deduped).
 */
function forwardAttachments(message: MailMessage): MailSourceAttachment[] {
  return (message.attachments ?? []).map((attachment) => ({
    messageId: message.id,
    attachmentId: attachment.id,
    filename: attachment.name,
    ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    ...(attachment.sizeBytes ? { sizeBytes: attachment.sizeBytes } : {}),
  }));
}

/** One message inside the conversation, Gmail-style: the newest is open, the
 * rest collapse to a single line until clicked. */
function ThreadMessage({
  message,
  expanded,
  onToggle,
  nonce,
}: {
  message: MailMessage;
  expanded: boolean;
  onToggle: () => void;
  /** CSP nonce for the embedded mail frame (see `MailHtmlBody`). */
  nonce?: string;
}) {
  const toggleStar = useMailStore((state) => state.toggleStar);
  const outbound = message.box === "sent";
  const snippet = message.preview || message.body.split("\n")[0] || "";

  const avatar = (
    <Avatar size={expanded ? "lg" : "default"}>
      <AvatarFallback className="text-[12px]">
        {mailInitials(outbound ? "me" : message.from.name)}
      </AvatarFallback>
    </Avatar>
  );

  if (!expanded) {
    return (
      <article className="border-b border-mail-line last:border-b-0">
        <div
          role="button"
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onToggle();
            }
          }}
          aria-label={`Expand message from ${outbound ? "me" : message.from.name}`}
          className="flex cursor-pointer items-center gap-3 px-6 py-3 transition-colors hover:bg-mail-row-hover"
        >
          {avatar}
          <span className="w-[150px] shrink-0 truncate text-[13px] font-semibold text-mail-strong">
            {outbound ? "me" : message.from.name}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-mail-muted">
            {snippet}
          </span>
          {message.attachments?.length ? (
            <Paperclip className="size-3.5 shrink-0 text-mail-muted" aria-hidden />
          ) : null}
          <span className="shrink-0 text-[13px] text-mail-muted">
            {formatMailFullDate(message.receivedAt)}
          </span>
          <button
            type="button"
            aria-label={message.starred ? "Remove star" : "Add star"}
            aria-pressed={message.starred}
            onClick={(event) => {
              event.stopPropagation();
              toggleStar(message.id);
            }}
            className="flex size-6 items-center justify-center rounded-md transition-colors hover:bg-mail-line"
          >
            <Star
              className={cn(
                "size-4",
                message.starred
                  ? "fill-warning text-warning"
                  : "text-mail-muted",
              )}
              aria-hidden
            />
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="border-b border-mail-line px-6 py-5 last:border-b-0">
      <div className="flex items-start gap-3">
        {avatar}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[14px] font-semibold text-mail-strong">
              {outbound ? "me" : message.from.name}
            </span>
            <span className="text-[13px] text-mail-muted">
              &lt;{message.from.email}&gt;
            </span>
          </div>
          <span className="text-[13px] text-mail-muted">
            to {message.to.map((address) => address.name).join(", ") || "me"}
            {message.cc?.length
              ? ` · cc ${message.cc.map((address) => address.name).join(", ")}`
              : ""}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-[13px] text-mail-muted">
            {formatMailFullDate(message.receivedAt)}
          </span>
          <button
            type="button"
            aria-label={message.starred ? "Remove star" : "Add star"}
            aria-pressed={message.starred}
            onClick={() => toggleStar(message.id)}
            className="flex size-7 items-center justify-center rounded-md transition-colors hover:bg-mail-row-hover"
          >
            <Star
              className={cn(
                "size-4",
                message.starred
                  ? "fill-warning text-warning"
                  : "text-mail-muted",
              )}
              aria-hidden
            />
          </button>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Collapse message"
                  onClick={onToggle}
                  className="flex size-7 items-center justify-center rounded-md text-mail-muted transition-colors hover:bg-mail-row-hover hover:text-mail-strong"
                >
                  <ChevronDown className="size-4 rotate-180" aria-hidden />
                </button>
              }
            />
            <TooltipContent>Collapse</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="mt-4">
        {/* Prefer the sender's HTML — the plain-text alternative of a
            designed email is a lossy transcription where every link
            collapses to a bare URL. */}
        {message.bodyHtml ? (
          <MailHtmlBody
            html={message.bodyHtml}
            nonce={nonce}
            // Newsletters are designed for a white page; render them on one so
            // their dark text and layout land as authored.
            variant={message.tag === "newsletter" ? "light" : "dark"}
          />
        ) : (
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-mail-strong">
            {message.body}
          </p>
        )}
      </div>

      {!!message.attachments?.length && (
        <div className="mt-4 flex flex-col gap-2 border-t border-mail-line pt-4">
          <span className="text-[12px] font-semibold uppercase text-mail-muted">
            {message.attachments.length} attachment
            {message.attachments.length > 1 ? "s" : ""}
          </span>
          <div className="flex flex-wrap gap-2">
            {message.attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="flex items-center gap-2 rounded-lg border border-mail-line bg-mail-chip px-3 py-2 text-[13px] text-mail-strong"
              >
                <Paperclip className="size-3.5 text-mail-muted" aria-hidden />
                {attachment.name}
                <span className="text-[12px] text-mail-muted">
                  {attachment.size}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

export function MailReader({
  subject,
  messages,
  loading = false,
  nonce,
}: {
  /** The conversation's base subject, prefix-free. */
  subject: string;
  /** Oldest message first. */
  messages: MailMessage[];
  /** True while the thread is being fetched and nothing is on screen yet. */
  loading?: boolean;
  /** The host document's CSP nonce, passed to each message frame. */
  nonce?: string;
}) {
  const closeConversation = useMailStore((state) => state.closeConversation);
  const archive = useMailStore((state) => state.archive);
  const remove = useMailStore((state) => state.remove);
  const deleteForever = useMailStore((state) => state.deleteForever);
  const snooze = useMailStore((state) => state.snooze);
  const setRead = useMailStore((state) => state.setRead);
  const setStarred = useMailStore((state) => state.setStarred);
  const openCompose = useMailStore((state) => state.openCompose);
  const filter = useMailStore((state) => state.filter);
  const inTrash = isTrashView(filter);

  const ids = React.useMemo(
    () => messages.map((message) => message.id),
    [messages],
  );
  const starred = messages.some((message) => message.starred);
  const latest = messages[messages.length - 1];
  const inbound =
    [...messages].reverse().find((message) => message.box !== "sent") ?? latest;

  // The newest message opens expanded; older ones collapse to a line, exactly
  // as Gmail presents a thread. State is per-thread (the reader is keyed by
  // conversation) so switching threads starts fresh. Until the user touches a
  // message the open set is *derived* from the latest messages, which keeps the
  // default correct even when the thread resolves after the reader mounts.
  const [manualExpanded, setManualExpanded] = React.useState<Set<string> | null>(
    null,
  );
  const expanded = React.useMemo(() => {
    if (manualExpanded) return manualExpanded;
    const last = messages[messages.length - 1];
    return new Set(last ? [last.id] : []);
  }, [manualExpanded, messages]);

  const toggle = (id: string) =>
    setManualExpanded(() => {
      const next = new Set(expanded);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);

  const reply = (all: boolean) => {
    if (!latest) return;
    openCompose({
      to: all
        ? [latest.from.email, ...latest.to.map((a) => a.email)].join(", ")
        : latest.from.email,
      subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
      body: quoted(latest),
      // Reply from the account the conversation lives in, so an Outlook thread
      // does not try to send through Gmail.
      ...(latest.provider ? { account: latest.provider } : {}),
      ...(latest.threadId ? { threadId: latest.threadId } : {}),
    });
  };

  const unsubscribe = async () => {
    if (inbound) {
      await fetch("/api/v1/mail/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderEmail: inbound.from.email,
          archiveThread: false,
        }),
      }).catch(() => null);
    }
    archive(ids);
    closeConversation();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-mail-surface">
      <div className="flex shrink-0 items-center gap-1 border-b border-mail-line bg-mail-surface px-6 py-3">
        <ReaderAction
          label="Back to list"
          icon={ArrowLeft}
          onClick={closeConversation}
        />
        <span className="mx-1 h-5 w-px bg-mail-line" aria-hidden />
        <ReaderAction label="Archive" icon={Archive} onClick={() => archive(ids)} />
        <ReaderAction
          label="Snooze until tomorrow"
          icon={ClockFading}
          onClick={() => snooze(ids, tomorrow)}
        />
        <ReaderAction
          label={inTrash ? "Delete forever" : "Delete"}
          icon={Trash2}
          onClick={() => (inTrash ? deleteForever(ids) : remove(ids))}
        />
        {inbound?.unsubscribe ? (
          <ReaderAction
            label="Unsubscribe from sender"
            icon={BellOff}
            onClick={() => void unsubscribe()}
          />
        ) : null}
        <LabelAction ids={ids} />
        <ReaderAction
          label="Mark as unread"
          icon={Mail}
          onClick={() => {
            setRead(ids, false);
            closeConversation();
          }}
        />
        <ReaderAction label="Print" icon={Printer} onClick={() => window.print()} />
      </div>

      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-6 py-6">
          <div className="flex items-start justify-between gap-4 pb-4">
            <h2 className="text-[22px] leading-snug font-medium text-mail-strong">
              {subject || "(no subject)"}
            </h2>
            <div className="flex shrink-0 items-center gap-2">
              {latest ? <MailTagBadge tag={latest.tag} /> : null}
              <button
                type="button"
                aria-label={starred ? "Remove star" : "Add star"}
                aria-pressed={starred}
                onClick={() => setStarred(ids, !starred)}
                className="flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-mail-row-hover"
              >
                <Star
                  className={cn(
                    "size-[18px]",
                    starred ? "fill-warning text-warning" : "text-mail-muted",
                  )}
                  aria-hidden
                />
              </button>
            </div>
          </div>

          {loading && messages.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-mail-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              <span className="text-[13px]">Opening conversation…</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Mail className="size-5 text-mail-muted/60" aria-hidden />
              <p className="text-[13px] text-mail-muted">
                This conversation couldn&apos;t be loaded. Try again from the
                list.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-mail-line">
              {messages.map((message) => (
                <ThreadMessage
                  key={message.id}
                  message={message}
                  expanded={expanded.has(message.id)}
                  onToggle={() => toggle(message.id)}
                  nonce={nonce}
                />
              ))}
            </div>
          )}

          {messages.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-5">
              <button
                type="button"
                onClick={() => reply(false)}
                className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[13px] font-medium text-mail-strong transition-colors hover:bg-mail-row-hover"
              >
                <Reply className="size-4" aria-hidden />
                Reply
              </button>
              <button
                type="button"
                onClick={() => reply(true)}
                className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[13px] font-medium text-mail-strong transition-colors hover:bg-mail-row-hover"
              >
                <ReplyAll className="size-4" aria-hidden />
                Reply all
              </button>
              <button
                type="button"
                onClick={() =>
                  latest &&
                  openCompose({
                    subject: subject.startsWith("Fwd:")
                      ? subject
                      : `Fwd: ${subject}`,
                    body: quoted(latest),
                    ...(latest.provider ? { account: latest.provider } : {}),
                    ...(latest.attachments?.length
                      ? {
                          sourceAttachments: forwardAttachments(latest),
                        }
                      : {}),
                  })
                }
                className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[13px] font-medium text-mail-strong transition-colors hover:bg-mail-row-hover"
              >
                <Forward className="size-4" aria-hidden />
                Forward
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
