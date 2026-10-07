import Link from "next/link";

import { PageHeader } from "@/components/app/shell/page-header";
import { flowRunRepository } from "@/lib/repositories/flow-runs";
import { requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";

/**
 * Index of the signed-in user's recent flow runs. `app/runs/[id]` already
 * renders one run's trace; without this page `/runs` 404'd even though it is
 * linked from the command palette and referenced by `robots.ts`.
 *
 * SQL lives in `FlowRunRepository`; the pageable contract is
 * `GET /api/v1/runs` (keyset cursor).
 */
export default async function RunsPage() {
  const session = await requireSession();

  const runs = await flowRunRepository.listForUser({
    userId: session.user.id,
    limit: 100,
  });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Runs"
        subtitle="Every automation the assistant executed, newest first."
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No runs yet. Activity appears here once the assistant processes your
            inbox.
          </p>
        ) : (
          <ul className="flex max-w-2xl flex-col">
            {runs.map((run) => (
              <li key={run.id} className="border-b border-border">
                <Link
                  href={`/runs/${run.id}`}
                  className="flex items-baseline gap-3 py-2.5 transition-colors hover:text-foreground"
                >
                  <span
                    className={cn(
                      "w-20 shrink-0 text-[11px] font-medium uppercase tracking-wider",
                      run.status === "failed"
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {run.status}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {run.triggerKind}
                  </span>
                  <time
                    dateTime={run.startedAt.toISOString()}
                    className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                  >
                    {run.startedAt.toISOString().replace("T", " ").slice(0, 16)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
