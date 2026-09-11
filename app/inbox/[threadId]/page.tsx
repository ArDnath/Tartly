import { notFound } from "next/navigation";

import { ThreadView } from "@/components/inbox/thread-view";
import { getThreadDetail } from "@/lib/inbox/service";
import { requireSession } from "@/lib/session";

export default async function InboxThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const session = await requireSession();
  const { threadId } = await params;
  const detail = await getThreadDetail({ userId: session.user.id, threadId });

  if (!detail) notFound();

  return <ThreadView detail={detail} />;
}
