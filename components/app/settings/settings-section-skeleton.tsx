import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * One shimmering block. `delay` phase-shifts the pulse so a stack of bars reads
 * as a top-to-bottom cascade (a "waterfall") instead of the whole pane blinking
 * in unison.
 */
function Bar({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <Skeleton
      className={cn("motion-reduce:animate-none", className)}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    />
  );
}

/**
 * Placeholder for a settings section while its server-rendered body streams in.
 *
 * The blocks mirror the shape common to the section layouts — an intro line,
 * labelled fields, a two-up row and a trailing action — so the swap to real
 * content barely shifts. Used by the intercepted route's `loading.tsx`, which
 * drops it into the modal's content pane on every section change.
 */
export function SettingsSectionSkeleton() {
  return (
    <div role="status" aria-live="polite" className="flex w-full flex-col gap-7">
      <span className="sr-only">Loading settings…</span>

      <div className="flex flex-col gap-2.5">
        <Bar className="h-2.5 w-24 rounded-full" delay={0} />
        <Bar className="h-9 w-full rounded-lg" delay={80} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2.5">
          <Bar className="h-2.5 w-20 rounded-full" delay={160} />
          <Bar className="h-9 w-full rounded-lg" delay={200} />
        </div>
        <div className="flex flex-col gap-2.5">
          <Bar className="h-2.5 w-20 rounded-full" delay={240} />
          <Bar className="h-9 w-full rounded-lg" delay={280} />
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <Bar className="h-2.5 w-28 rounded-full" delay={320} />
        <Bar className="h-24 w-full rounded-lg" delay={360} />
      </div>

      <div className="flex items-center gap-3">
        <Bar className="h-9 w-24 rounded-lg" delay={420} />
        <Bar className="h-3 w-16 rounded-full" delay={470} />
      </div>
    </div>
  );
}
