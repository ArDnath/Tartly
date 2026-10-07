"use client";

import { forwardRef, type CSSProperties, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

export type RevealDirection = "up" | "down" | "left" | "right" | "none";

export interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Seconds to wait after the element enters the viewport. */
  delay?: number;
  /** Tween length in seconds. Deliberately unhurried — the marketing page
   *  fades in and back out as you scroll. */
  duration?: number;
  /** Travel distance in px (ignored when `direction` is "none"). */
  distance?: number;
  direction?: RevealDirection;
  /** Fade in from a soft blur — the React Bits "Blur Text" feel. */
  blur?: boolean;
  /** Optional scale-in (1 keeps the element at rest). */
  scale?: number;
  /** Reveal once and stay put. */
  once?: boolean;
  /** Fraction of the element that must be visible to trigger. */
  amount?: number;
  style?: CSSProperties;
}

/**
 * Scroll-triggered entrance used across the marketing page.
 *
 * Content rises and fades in as it enters the viewport and eases back out as it
 * leaves, so the long page breathes in both directions rather than snapping to
 * a final state. Motion is skipped entirely under `prefers-reduced-motion`, and
 * the `data-reveal` hook lets print styles force the final state for static
 * captures.
 */
const OFFSET: Record<RevealDirection, (distance: number) => { x?: number; y?: number }> = {
  up: (distance) => ({ y: distance }),
  down: (distance) => ({ y: -distance }),
  left: (distance) => ({ x: distance }),
  right: (distance) => ({ x: -distance }),
  none: () => ({}),
};

export const Reveal = forwardRef<HTMLDivElement, RevealProps>(function Reveal(
  {
    children,
    className,
    delay = 0,
    duration = 1.1,
    distance = 24,
    direction = "up",
    blur = false,
    scale = 1,
    once = false,
    amount = 0.2,
    style,
  },
  ref,
) {
  const reduce = useReducedMotion();

  if (reduce) {
    return (
      <div ref={ref} className={className} style={style}>
        {children}
      </div>
    );
  }

  const hidden: Record<string, number | string> = {
    opacity: 0,
    ...OFFSET[direction](distance),
  };
  if (scale !== 1) hidden.scale = scale;
  if (blur) hidden.filter = "blur(10px)";

  const visible: Record<string, number | string> = {
    opacity: 1,
    x: 0,
    y: 0,
    scale: 1,
  };
  if (blur) visible.filter = "blur(0px)";

  return (
    <motion.div
      ref={ref}
      data-reveal
      className={cn(className)}
      style={style}
      initial={hidden}
      whileInView={visible}
      viewport={{ once, amount, margin: "0px 0px -8% 0px" }}
      transition={{ duration, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
});
