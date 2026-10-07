"use client";

import { useRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

export interface SpotlightCardProps extends ComponentPropsWithoutRef<"div"> {
  /** Colour of the cursor-follow spot. Keep it faint — this is a hint, not a light. */
  spotlightColor?: string;
}

/**
 * React Bits "Spotlight Card": a soft radial glow tracks the pointer across a
 * card. Coordinates are written straight to CSS variables (no re-render per
 * move) and the glow fades in on hover / keyboard focus.
 */
export function SpotlightCard({
  children,
  className,
  spotlightColor = "rgba(139, 92, 246, 0.14)",
  ...props
}: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    node.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
    node.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
  };

  return (
    <div
      ref={ref}
      onPointerMove={handlePointerMove}
      className={cn("group/spotlight relative overflow-hidden", className)}
      {...props}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover/spotlight:opacity-100 group-focus-within/spotlight:opacity-100"
        style={{
          background: `radial-gradient(280px circle at var(--spot-x, 50%) var(--spot-y, 50%), ${spotlightColor}, transparent 72%)`,
        }}
      />
      {children}
    </div>
  );
}
