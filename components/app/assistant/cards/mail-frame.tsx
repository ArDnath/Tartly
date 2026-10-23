import type { ReactNode } from "react";

import { CornerMarks } from "@/components/shared/geom/corner-marks";
import { cn } from "@/lib/utils";

/**
 * The squared, hairline frame the agent's mail artifacts share.
 *
 * The transcript's mail cards are instrument panels, not floating cards: no
 * rounding, no ring, no shadow — a 1px `--mail-line` border, four corner
 * registration marks, and a header rule carry the hierarchy. `relative` hosts
 * the marks and `overflow-hidden` clips the header and rows to the frame.
 */
export function MailFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden border border-mail-line bg-card/40",
        className,
      )}
    >
      <CornerMarks />
      {children}
    </div>
  );
}
