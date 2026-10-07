import { notFound } from "next/navigation";

import { PageHeader } from "@/components/app/shell/page-header";
import { flowRunRepository } from "@/lib/repositories/flow-runs";
import { requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";

/** Read-only run panel: the per-node trace of one flow run. */
export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const run = await flowRunRepository.findByIdForUser(session.user.id, id);
  if (!run) notFound();

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Run">
        <span className="shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground">
          {run.status}
        </span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <ol className="flex max-w-2xl flex-col">
          {run.trace.map((entry, index) => (
            <li
              key={`${entry.nodeId}-${index}`}
              className="flex items-baseline gap-3 border-b border-border py-2.5"
            >
              <span className="w-6 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {entry.type}
              </span>
              <span
                className={cn(
                  "shrink-0 text-[11px]",
                  entry.status === "ok"
                    ? "text-muted-foreground"
                    : "text-destructive",
                )}
              >
                {entry.status}
              </span>
              <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {entry.ms}ms
              </span>
            </li>
          ))}
        </ol>

        {run.error ? (
          <pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-card p-3 text-xs text-destructive">
            {JSON.stringify(run.error, null, 2)}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
