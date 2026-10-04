"use client";

import { PaperclipIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { ASSISTANT_CLOSE_EVENT } from "@/components/assistant/assistant-events";
import { useMailStore } from "@/components/mail/mail-store";
import { MailTagBadge } from "@/components/mail/mail-tag-badge";
import { formatMailTime } from "@/lib/mail/format";
import { cn } from "@/lib/utils";

import { parseMailAddress } from "./shared";

/**
 * The shape any tool result can supply for the mail it touched. Every field is
 * optional because the tools return different slices: `search_emails` knows the
 * sender and snippet, `delete_email` only knows the id, `send_email` only knows
 * the recipients. Whatever is missing is filled from the live mail store when
 * the id happens to be loaded.
 */
export interface EmailReference {
  id?: string;
  from?: string;
  to?: string[];
  subject?: string;
  snippet?: string;
  date?: string;
  unread?: boolean;
  hasAttachments?: boolean;
}

/** Strip a `Name <email>` down to a display name, keeping a bare address. */
function senderName(from: string | undefined): string | undefined {
  const { name, email } = parseMailAddress(from);
  return name ?? email;
}

/**
 * Open a message in the mail client.
 *
 * Inside `/mail` the live store owns the reader next to this panel, so the
 * message opens in place (fetching its body first if the current page never
 * loaded it). Anywhere else — the dedicated `/assistant` page — the same click
 * falls back to the `/mail/[id]` deep link.
 */
export function useOpenMailMessage(): (id: string) => void {
  const router = useRouter();

  return useCallback(
    (id: string) => {
      if (
        typeof window !== "undefined" &&
        window.location.pathname.startsWith("/mail")
      ) {
        void useMailStore.getState().openById(id);
        // On a phone the panel covers the mail; dismiss it so the reader shows.
        if (window.matchMedia("(max-width: 767px)").matches) {
          window.dispatchEvent(new Event(ASSISTANT_CLOSE_EVENT));
        }
        return;
      }
      router.push(`/mail/${encodeURIComponent(id)}`);
    },
    [router],
  );
}

/**
 * A compact, single-line mail row for tool results that reference one message
 * (action receipts, confirmations, mailbox changes). It shows sender, subject,
 * type and date on one line and opens the message in the mail client.
 */
export function AgentEmailRef({
  email,
  className,
}: {
  email: EmailReference;
  className?: string;
}) {
  const openMessage = useOpenMailMessage();
  const stored = useMailStore((state) =>
    email.id ? state.messages.find((item) => item.id === email.id) : undefined,
  );

  const id = email.id ?? stored?.id;
  const to = email.to?.length
    ? email.to
    : stored?.to?.map((address) => address.name || address.email);
  const sender =
    senderName(email.from) ??
    (stored?.from ? stored.from.name || stored.from.email : undefined) ??
    (to?.length ? `To: ${to.join(", ")}` : undefined) ??
    "Email";
  const subject = email.subject ?? stored?.subject ?? "(no subject)";
  const date = email.date ?? stored?.receivedAt;
  const unread = email.unread ?? stored?.unread ?? false;
  const hasAttachments =
    email.hasAttachments ?? Boolean(stored?.attachments?.length);

  const content = (
    <>
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full bg-mail-unread",
          unread ? "opacity-100" : "opacity-0",
        )}
      />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={cn(
            "min-w-0 shrink-0 max-w-[45%] truncate text-[12px]",
            unread ? "font-semibold text-mail-strong" : "text-mail-strong/80",
          )}
        >
          {sender}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-mail-strong/70">
          {subject}
        </span>
      </span>
      {stored?.tag ? <MailTagBadge tag={stored.tag} className="shrink-0" /> : null}
      {hasAttachments ? (
        <PaperclipIcon className="size-3 shrink-0 text-mail-muted" aria-hidden />
      ) : null}
      {date ? (
        <span className="shrink-0 text-[11px] tabular-nums text-mail-muted">
          {formatMailTime(date)}
        </span>
      ) : null}
    </>
  );

  const base = cn(
    "group/email flex w-full items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-left transition-colors",
    className,
  );

  if (!id) {
    return <div className={base}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => openMessage(id)}
      title="Open in Mail"
      className={cn(
        base,
        "hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      {content}
    </button>
  );
}
