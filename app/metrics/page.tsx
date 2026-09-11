import Link from "next/link";

import { PageHeader } from "@/components/app-shell/page-header";
import { getMetrics } from "@/lib/metrics/service";
import { requireSession } from "@/lib/session";

export default async function MetricsPage() {
  const session = await requireSession();
  const metrics = await getMetrics({ userId: session.user.id, sinceDays: 7 });

  const stats = [
    { label: "Runs", value: metrics.runs },
    { label: "Drafts", value: metrics.drafts },
    { label: "Replies sent", value: metrics.repliesSent },
    { label: "Meetings booked", value: metrics.meetingsBooked },
    { label: "Follow-ups active", value: metrics.followupsActive },
  ];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Activity"
        subtitle={`What your assistant did in the last ${metrics.sinceDays} days.`}
      >
        <Link
          href="/runs"
          className="shrink-0 text-[12px] font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          View runs
        </Link>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-border bg-card px-4 py-5"
            >
              <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {stat.label}
              </dt>
              <dd className="mt-2 text-[28px] font-semibold leading-none tabular-nums tracking-tight text-foreground">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
