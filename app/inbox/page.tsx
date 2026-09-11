import { InboxView } from "@/components/inbox/inbox-view";
import {
  listInbox,
  type InboxView as InboxViewName,
} from "@/lib/inbox/service";
import { requireSession } from "@/lib/session";

function parseView(value: string | string[] | undefined): InboxViewName {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "waiting" || raw === "handled") return raw;
  return "needs_you";
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

  const items = await listInbox({ userId: session.user.id, view });

  return <InboxView view={view} items={items} />;
}
