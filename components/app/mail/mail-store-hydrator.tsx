"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

import { useMailStore } from "@/components/app/mail/mail-store";
import type { InitialMailbox } from "@/lib/mail/types";

/**
 * `useLayoutEffect` warns when a client component is rendered on the server, so
 * fall back to `useEffect` there. On the client we want the layout variant: it
 * runs before the browser paints and before the sibling/passive effects, so the
 * store is seeded before `AppSidebar` or `MailScreen` can decide to fetch.
 */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Seeds the mail store from the server-prefetched mailbox.
 *
 * Rendered (via `MailPrefetch`) inside a `<Suspense>` boundary, so it mounts
 * only once the Gmail read resolves — by then the shell is already on screen.
 * `MailScreen` holds its own fetch until `settlePrefetch` fires, which prevents
 * a client request from racing the server one.
 */
export function MailStoreHydrator({
  mailbox,
}: {
  mailbox: InitialMailbox | null;
}) {
  const seeded = useRef(false);

  useIsomorphicLayoutEffect(() => {
    if (seeded.current) return;
    seeded.current = true;

    const store = useMailStore.getState();
    if (mailbox) store.hydrate(mailbox);
    // Always settle — on failure (`null`) this releases `MailScreen`'s deferred
    // load so it falls back to the client fetch.
    store.settlePrefetch();
  }, [mailbox]);

  return null;
}
