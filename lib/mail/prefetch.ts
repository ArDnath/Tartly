import "server-only";

import { getEntitlement } from "@/lib/billing/entitlements";
import { freeMailViewLimit } from "@/lib/env";
import {
  listConnectedAccounts,
  resolveProviderEmails,
} from "@/lib/mail/accounts";
import { listUnifiedMessages } from "@/lib/mail/unified";
import type { InitialMailbox } from "@/lib/mail/types";

/**
 * Same page size the client requests in `fetchMailbox`, so a server-hydrated
 * mailbox matches what the client would have fetched itself.
 */
const INITIAL_MAILBOX_LIMIT = 60;

/**
 * Fetch the default mailbox (the shared inbox) on the server so `/mail` paints
 * rows on the first render instead of mounting, then round-tripping to
 * `/api/v1/mail/messages`.
 *
 * Best-effort: a missing/revoked grant or a provider hiccup must not take the
 * page down — returning `null` falls back to the existing client fetch.
 */
export async function loadInitialMailbox(
  userId: string,
): Promise<InitialMailbox | null> {
  try {
    const entitlement = await getEntitlement(userId);
    // Free tier never prefetches more than its allowance, and gets no cursor:
    // the server prefetch must not seed the client with a full mailbox.
    const limit = entitlement.isSubscriber
      ? INITIAL_MAILBOX_LIMIT
      : freeMailViewLimit();
    const [mailbox, emails, accounts] = await Promise.all([
      listUnifiedMessages(userId, { box: "inbox", limit }),
      resolveProviderEmails(userId),
      listConnectedAccounts(userId).catch(() => []),
    ]);

    const address = emails.gmail ?? emails.outlook ?? "";

    return {
      messages: mailbox.messages,
      labels: mailbox.labels,
      account: {
        name: address.split("@")[0] || "Me",
        email: address,
      },
      accounts,
      ...(entitlement.isSubscriber && mailbox.nextPageToken
        ? { nextPageToken: mailbox.nextPageToken }
        : {}),
    };
  } catch (error) {
    console.warn("[mail] initial mailbox prefetch failed", error);
    return null;
  }
}
