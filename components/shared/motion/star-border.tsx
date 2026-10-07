"use client";

import type { CSSProperties, HTMLAttributes } from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

export interface StarBorderProps extends HTMLAttributes<HTMLDivElement> {
  /** Colour of the travelling star. */
  color?: string;
  /** Seconds for one sweep from edge to edge. */
  speed?: number;
  /** Thickness of the revealed border, in px. */
  thickness?: number;
  /** Outer corner radius, in px. */
  radius?: number;
  innerClassName?: string;
}

/**
 * React Bits "Star Border": two soft comets sweep the top and bottom edges of
 * an otherwise quiet surface. Implemented with `motion` (no keyframe stylesheet)
 * so it degrades cleanly and pauses under reduced motion.
 */
export function StarBorder({
  children,
  className,
  color = "#8b5cf6",
  speed = 6,
  thickness = 1,
  radius = 10,
  innerClassName,
  ...props
}: StarBorderProps) {
  const reduce = useReducedMotion();

  const layer = (side: "top" | "bottom"): CSSProperties => ({
    height: "50%",
    width: "300%",
    borderRadius: "50%",
    background: `radial-gradient(circle, ${color}, transparent 10%)`,
    [side]: -12,
    [side === "bottom" ? "right" : "left"]: "-250%",
  });

  return (
    <div
      className={cn("relative inline-flex overflow-hidden", className)}
      style={{ padding: `${thickness}px 0`, borderRadius: radius }}
      {...props}
    >
      {(["bottom", "top"] as const).map((side) => (
        <motion.span
          key={side}
          aria-hidden
          className="pointer-events-none absolute opacity-70"
          style={layer(side)}
          animate={reduce ? undefined : { x: side === "bottom" ? ["0%", "-100%"] : ["0%", "100%"], opacity: [1, 0] }}
          transition={{ duration: speed, repeat: Infinity, repeatType: "reverse", ease: "linear" }}
        />
      ))}
      <div
        className={cn("relative z-10 overflow-hidden", innerClassName)}
        style={{ borderRadius: Math.max(radius - thickness, 0) }}
      >
        {children}
      </div>
    </div>
  );
}
