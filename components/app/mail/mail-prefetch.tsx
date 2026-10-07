import "server-only";

import { MailStoreHydrator } from "@/components/app/mail/mail-store-hydrator";
import { loadInitialMailbox } from "@/lib/mail/prefetch";

/**
 * Streams the initial mailbox into the mail store without blocking the shell.
 *
 * `/mail` renders its frame immediately and wraps this in `<Suspense>`. When
 * the Gmail read resolves, the client hydrator seeds the store and signals
 * `prefetchSettled`, which is what releases `MailScreen`'s deferred load.
 */
export async function MailPrefetch({ userId }: { userId: string }) {
  const mailbox = await loadInitialMailbox(userId);
  return <MailStoreHydrator mailbox={mailbox} />;
}
