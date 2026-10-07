"use client";

import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export interface GlareHoverProps extends HTMLAttributes<HTMLDivElement> {
  /** Peak opacity of the sheen as it crosses. */
  intensity?: number;
}

/**
 * React Bits "Glare Hover": a skewed highlight sweeps across the surface on
 * hover. A single translated layer, so it costs nothing at rest.
 */
export function GlareHover({
  children,
  className,
  intensity = 0.08,
  ...props
}: GlareHoverProps) {
  return (
    <div className={cn("group/glare relative overflow-hidden", className)} {...props}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-20 w-1/3 -translate-x-[160%] -skew-x-12 transition-transform duration-700 ease-out group-hover/glare:translate-x-[380%]"
        style={{
          background: `linear-gradient(to right, transparent, rgba(255,255,255,${intensity}), transparent)`,
        }}
      />
      {children}
    </div>
  );
}
