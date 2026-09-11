import "server-only";

import { listMessages, profile } from "@/lib/mail/service";
import type { InitialMailbox } from "@/lib/mail/types";

/**
 * Same page size the client requests in `fetchMailbox`, so a server-hydrated
 * mailbox matches what the client would have fetched itself.
 */
const INITIAL_MAILBOX_LIMIT = 60;

/**
 * Fetch the default mailbox (`all` → Gmail INBOX) on the server so `/mail`
 * paints rows on the first render instead of mounting, then round-tripping to
 * `/api/v1/mail/messages`.
 *
 * Best-effort: a missing/revoked Google grant or a Gmail hiccup must not take
 * the page down — returning `null` falls back to the existing client fetch.
 */
export async function loadInitialMailbox(
  userId: string,
): Promise<InitialMailbox | null> {
  try {
    const [mailbox, account] = await Promise.all([
      listMessages(userId, { box: "inbox", limit: INITIAL_MAILBOX_LIMIT }),
      profile(userId),
    ]);

    return {
      messages: mailbox.messages,
      labels: mailbox.labels,
      account: {
        name: account.emailAddress.split("@")[0] ?? "Me",
        email: account.emailAddress,
      },
    };
  } catch (error) {
    console.warn("[mail] initial mailbox prefetch failed", error);
    return null;
  }
}
