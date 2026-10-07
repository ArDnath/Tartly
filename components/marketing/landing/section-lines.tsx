import { cn } from "@/lib/utils";

/**
 * The landing page's below-the-fold line system.
 *
 * The hero already frames its demo with hairline edges (`border-x` / `border-t`
 * on the container). These two primitives continue that measured, instrument-
 * panel language down the rest of the page: continuous vertical hairlines split
 * the body into columns, and horizontal rules close each section off.
 *
 * Everything is drawn at the same 1250px instrument width the hero frame, the
 * trust panel, and the pricing table use, so every line on the page lines up.
 * Both pieces are decorative only: `aria-hidden`, `pointer-events-none`, and
 * rendered behind the content (`z-0`), so sections paint over them and the
 * lines surface only in the gutters and the gaps between sections.
 */

/**
 * A horizontal hairline that separates two landing sections.
 *
 * Use it in flow as a standalone divider, or absolutely positioned inside a
 * `relative` section to centre it in that section's top margin. Short vertical
 * ticks at the ends and thirds land exactly where <VerticalGridLines> draws its
 * rules, so the two read as a single crosshair grid rather than two effects.
 */
export function SectionRule({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none mx-auto w-full max-w-[1250px] px-6",
        className,
      )}
    >
      <div className="relative h-px w-full bg-white/10">
        {(
          [
            "left-0",
            "left-1/3",
            "left-2/3",
            "right-0",
          ] as const
        ).map((position) => (
          <span
            key={position}
            className={cn(
              "absolute -top-2 h-4 w-px bg-white/20",
              position,
            )}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Continuous vertical hairlines behind every below-hero section.
 *
 * Rendered once as an absolutely-positioned overlay filling a `relative`
 * wrapper that spans the sections it should divide. Lines sit at the container
 * edges plus the thirds, so the three-column feature grid and the two-column
 * trust/pricing compositions align with them. Hidden below `md`, where the
 * stacked layout has no columns to divide.
 */
export function VerticalGridLines({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 z-0 mx-auto hidden w-full max-w-[1250px] px-6 md:block",
        className,
      )}
    >
      <div className="relative h-full w-full">
        <span className="absolute inset-y-0 left-0 w-px bg-white/10" />
        <span className="absolute inset-y-0 right-0 w-px bg-white/10" />
        <span className="absolute inset-y-0 left-1/3 w-px bg-white/[0.05]" />
        <span className="absolute inset-y-0 left-2/3 w-px bg-white/[0.05]" />
      </div>
    </div>
  );
}
