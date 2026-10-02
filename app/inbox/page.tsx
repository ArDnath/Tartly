import { InboxView } from "@/components/inbox/inbox-view";
import {
  listInbox,
  normalizeView,
  type InboxView as InboxViewName,
} from "@/lib/inbox/service";
import { getLatestDigest } from "@/lib/ai/features/digest";
import { isDigestEnabled } from "@/lib/env";
import { requireSession } from "@/lib/session";

function parseView(value: string | string[] | undefined): InboxViewName {
  const raw = Array.isArray(value) ? value[0] : value;
  // Legacy `?view=needs_you|handled` deep links resolve through the aliases.
  return normalizeView(raw) ?? "needs_reply";
}

/**
 * Server-renders the selected view so the inbox paints without a client fetch.
 * The view lives in the URL (`?view=`) so the sidebar and header can both link
 * to it.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const view = parseView(params.view);

  const [items, digest] = await Promise.all([
    listInbox({ userId: session.user.id, view }),
    getLatestDigest(session.user.id),
  ]);

  return (
    <InboxView
      view={view}
      items={items}
      digest={digest}
      digestEnabled={isDigestEnabled()}
    />
  );
}
