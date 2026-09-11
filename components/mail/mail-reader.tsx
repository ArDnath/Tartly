"use client";

import {
  Archive,
  ArrowLeft,
  ClockFading,
  Forward,
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
import { useMailStore } from "@/components/mail/mail-store";
import { formatMailFullDate, mailInitials } from "@/lib/mail/format";
import { LabelAction } from "@/components/mail/mail-toolbar";
import { MailTagBadge } from "@/components/mail/mail-tag-badge";
import { MailHtmlBody } from "@/components/mail/mail-html-body";
import type { MailMessage } from "@/lib/mail/types";

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

export function MailReader({ message }: { message: MailMessage }) {
  const closeMessage = useMailStore((state) => state.closeMessage);
  const toggleStar = useMailStore((state) => state.toggleStar);
  const archive = useMailStore((state) => state.archive);
  const remove = useMailStore((state) => state.remove);
  const snooze = useMailStore((state) => state.snooze);
  const setRead = useMailStore((state) => state.setRead);
  const openCompose = useMailStore((state) => state.openCompose);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);

  const reply = (all: boolean) =>
    openCompose({
      to: all
        ? [message.from.email, ...message.to.map((a) => a.email)].join(", ")
        : message.from.email,
      subject: message.subject.startsWith("Re:")
        ? message.subject
        : `Re: ${message.subject}`,
      body: quoted(message),
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-mail-surface">
      <div className="flex shrink-0 items-center gap-1 border-b border-mail-line bg-mail-surface px-6 py-3">
        <ReaderAction
          label="Back to list"
          icon={ArrowLeft}
          onClick={closeMessage}
        />
        <span className="mx-1 h-5 w-px bg-mail-line" aria-hidden />
        <ReaderAction
          label="Archive"
          icon={Archive}
          onClick={() => archive([message.id])}
        />
        <ReaderAction
          label="Snooze until tomorrow"
          icon={ClockFading}
          onClick={() => snooze([message.id], tomorrow)}
        />
        <ReaderAction
          label="Delete"
          icon={Trash2}
          onClick={() => remove([message.id])}
        />
        <LabelAction ids={[message.id]} />
        <ReaderAction
          label="Mark as unread"
          icon={Mail}
          onClick={() => {
            setRead([message.id], false);
            closeMessage();
          }}
        />
        <ReaderAction
          label="Print"
          icon={Printer}
          onClick={() => window.print()}
        />
      </div>

      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="flex w-full flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-[22px] leading-snug font-medium text-mail-strong">
              {message.subject || "(no subject)"}
            </h2>
            <div className="flex shrink-0 items-center gap-2">
              <MailTagBadge tag={message.tag} />
              <button
                type="button"
                aria-label={message.starred ? "Remove star" : "Add star"}
                aria-pressed={message.starred}
                onClick={() => toggleStar(message.id)}
                className="flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-mail-row-hover"
              >
                <Star
                  className={cn(
                    "size-[18px]",
                    message.starred
                      ? "fill-warning text-warning"
                      : "text-mail-muted",
                  )}
                  aria-hidden
                />
              </button>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Avatar size="lg">
              <AvatarFallback className="text-[13px]">
                {mailInitials(message.from.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[14px] font-semibold text-mail-strong">
                  {message.from.name}
                </span>
                <span className="text-[13px] text-mail-muted">
                  &lt;{message.from.email}&gt;
                </span>
              </div>
              <span className="text-[13px] text-mail-muted">
                to{" "}
                {message.to.map((address) => address.name).join(", ") || "me"}
                {message.cc?.length
                  ? ` · cc ${message.cc.map((address) => address.name).join(", ")}`
                  : ""}
              </span>
            </div>
            <span className="shrink-0 text-[13px] text-mail-muted">
              {formatMailFullDate(message.receivedAt)}
            </span>
          </div>

          {/* Prefer the sender's HTML — the plain-text alternative of a
              designed email is a lossy transcription where every link
              collapses to a bare URL. */}
          {message.bodyHtml ? (
            <MailHtmlBody html={message.bodyHtml} />
          ) : (
            <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-mail-strong">
              {message.body}
            </p>
          )}

          {!!message.attachments?.length && (
            <div className="flex flex-col gap-2 border-t border-mail-line pt-4">
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
                    <Paperclip
                      className="size-3.5 text-mail-muted"
                      aria-hidden
                    />
                    {attachment.name}
                    <span className="text-[12px] text-mail-muted">
                      {attachment.size}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
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
                openCompose({
                  subject: message.subject.startsWith("Fwd:")
                    ? message.subject
                    : `Fwd: ${message.subject}`,
                  body: quoted(message),
                })
              }
              className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[13px] font-medium text-mail-strong transition-colors hover:bg-mail-row-hover"
            >
              <Forward className="size-4" aria-hidden />
              Forward
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
