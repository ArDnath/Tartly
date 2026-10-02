import type { Metadata } from "next";

import { ActivityDashboardView } from "@/components/activity/dashboard";
import { getActivityDashboard } from "@/lib/activity/service";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Activity — Lunabox",
};

/**
 * Operator activity board. Everything is derived from rows the runtime already
 * writes — agent runs, flow runs, drafts, meetings, follow-ups, approvals,
 * inbound mail and the AI usage ledger — so the screen never invents a number.
 */
export default async function ActivityPage() {
  const session = await requireSession();
  const data = await getActivityDashboard({ userId: session.user.id });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ActivityDashboardView data={data} />
    </div>
  );
}
