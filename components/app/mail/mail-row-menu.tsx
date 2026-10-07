"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { useMailStore } from "@/components/app/mail/mail-store";
import {
  conversationMessageIds,
  lastInbound,
} from "@/lib/mail/conversations";
import type { MailConversation } from "@/lib/mail/types";

/**
 * One handle shared by every row's "more actions" trigger. A handle — not a
 * Popover.Root per row — is what makes this a single detached popup that
 * reparents between rows: only one trigger can ever be "active" at a time,
 * and switching rows repositions that one Popup instead of unmounting one
 * and mounting another (which is what produced a one-frame flash at the
 * page origin, and let two rows show their menu-open state at once).
 */
export type MailRowMenuHandle = ReturnType<
  typeof PopoverPrimitive.createHandle<MailConversation>
>;

export function createMailRowMenuHandle(): MailRowMenuHandle {
  return PopoverPrimitive.createHandle<MailConversation>();
}

/** Rendered once per mail list — every row's ⋯ button targets this same handle. */
export function MailRowMenu({ handle }: { handle: MailRowMenuHandle }) {
  const setRead = useMailStore((state) => state.setRead);
  const markSpam = useMailStore((state) => state.markSpam);
  const archive = useMailStore((state) => state.archive);

  const unsubscribe = async (conversation: MailConversation) => {
    const sender = lastInbound(conversation);
    if (sender) {
      await fetch("/api/v1/mail/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderEmail: sender.from.email,
          threadId: conversation.threadId,
          archiveThread: false,
        }),
      }).catch(() => null);
    }
    archive(conversationMessageIds(conversation));
    handle.close();
  };

  return (
    <PopoverPrimitive.Root handle={handle}>
      {({ payload: conversation }) => (
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Positioner
            side="bottom"
            align="end"
            sideOffset={4}
            className="isolate z-50"
          >
            <PopoverPrimitive.Popup
              data-slot="mail-row-menu-popup"
              onClick={(event) => event.stopPropagation()}
              className="z-50 flex w-52 origin-(--transform-origin) flex-col gap-0.5 rounded-lg bg-popover p-1.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
            >
              {conversation && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setRead(
                        conversationMessageIds(conversation),
                        conversation.unread,
                      );
                      handle.close();
                    }}
                    className="rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent"
                  >
                    {conversation.unread ? "Mark as read" : "Mark as unread"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      markSpam(
                        conversationMessageIds(conversation),
                        conversation.box !== "spam",
                      );
                      handle.close();
                    }}
                    className="rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent"
                  >
                    {conversation.box === "spam" ? "Not spam" : "Report spam"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void unsubscribe(conversation)}
                    className="rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent"
                  >
                    Unsubscribe &amp; archive
                  </button>
                </>
              )}
            </PopoverPrimitive.Popup>
          </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
      )}
    </PopoverPrimitive.Root>
  );
}
