"use client";

import {
  ChevronRightIcon,
  MailIcon,
  MailOpenIcon,
  PaperclipIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, type ReactNode } from "react";

import { ASSISTANT_CLOSE_EVENT } from "@/components/assistant/assistant-events";
import { useMailStore } from "@/components/mail/mail-store";
import { formatMailTime } from "@/lib/mail/format";
import { cn } from "@/lib/utils";

import { asString } from "./shared";

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
  const value = asString(from);
  if (!value) return undefined;
  const angle = /^(.*?)\s*<[^>]+>\s*$/.exec(value);
  const name = (angle?.[1] ?? value).trim().replace(/^"(.*)"$/, "$1");
  return name || value;
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
 * A compact, clickable email preview for the agent transcript.
 *
 * It replaces the raw message id a tool result used to print: a mail-client row
 * showing sender (or recipients), subject, snippet and time. Clicking it opens
 * the message in the main mail UI. When a tool gives us only an id that is not
 * in the store yet the row still renders and opens on click, because the store
 * fetches the body by id.
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
    : stored?.to.map((address) => address.name || address.email);
  const sender =
    senderName(email.from) ??
    (stored ? stored.from.name || stored.from.email : undefined) ??
    (to?.length ? `To: ${to.join(", ")}` : undefined) ??
    "Email";
  const subject = email.subject ?? stored?.subject ?? "(no subject)";
  const snippet = email.snippet ?? stored?.preview;
  const date = email.date ?? stored?.receivedAt;
  const unread = email.unread ?? stored?.unread ?? false;
  const hasAttachments =
    email.hasAttachments ?? Boolean(stored?.attachments?.length);

  const content: ReactNode = (
    <>
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {unread ? (
          <MailIcon className="size-3.5" aria-hidden />
        ) : (
          <MailOpenIcon className="size-3.5" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-xs",
              unread
                ? "font-semibold text-foreground"
                : "text-muted-foreground",
            )}
          >
            {sender}
          </span>
          {date ? (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {formatMailTime(date)}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-sm text-foreground">
          {subject}
        </span>
        {snippet ? (
          <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
            {snippet}
          </span>
        ) : null}
        {hasAttachments ? (
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <PaperclipIcon className="size-3" aria-hidden />
            Attachment
          </span>
        ) : null}
      </span>
    </>
  );

  const base = cn(
    "group/email flex w-full items-start gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2 text-left transition-colors",
    className,
  );

  if (!id) {
    return <div className={base}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => openMessage(id)}
      title="Open in mail"
      aria-label={`Open email: ${subject}`}
      className={cn(
        base,
        "hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      {content}
      <ChevronRightIcon
        className="mt-0.5 size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover/email:translate-x-0.5 group-hover/email:text-muted-foreground"
        aria-hidden
      />
    </button>
  );
}
