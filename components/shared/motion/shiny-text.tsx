"use client";

import { useRef, useState, type CSSProperties } from "react";
import { motion, useAnimationFrame, useMotionValue, useReducedMotion, useTransform } from "motion/react";

import { cn } from "@/lib/utils";

export interface ShinyTextProps {
  text: string;
  className?: string;
  /** Hold the shine still (e.g. reduced-motion fallbacks or A/B states). */
  disabled?: boolean;
  /** Seconds for one pass of the highlight. */
  speed?: number;
  /** Base ink of the text. */
  color?: string;
  /** Highlight that sweeps across. */
  shineColor?: string;
  /** Gradient angle in degrees. */
  spread?: number;
  pauseOnHover?: boolean;
}

/**
 * React Bits "Shiny Text": a highlight sweeps across a gradient-clipped label.
 *
 * Driven by `useAnimationFrame` so it keeps a steady cadence regardless of
 * layout. Under reduced motion the gradient renders statically at the base
 * colour instead of being dropped.
 */
export function ShinyText({
  text,
  className,
  disabled = false,
  speed = 4,
  color = "#a1a1aa",
  shineColor = "#ffffff",
  spread = 120,
  pauseOnHover = false,
}: ShinyTextProps) {
  const reduce = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const progress = useMotionValue(0);
  const last = useRef<number | null>(null);
  const elapsed = useRef(0);

  useAnimationFrame((time) => {
    if (disabled || paused || reduce) {
      last.current = null;
      return;
    }
    if (last.current === null) {
      last.current = time;
      return;
    }
    elapsed.current += time - last.current;
    last.current = time;
    progress.set((elapsed.current / (speed * 1000)) % 1);
  });

  // p = 0 → shine parked to the right; p = 1 → parked to the left.
  const backgroundPosition = useTransform(progress, (p) => `${140 - p * 220}% center`);

  const gradientStyle: CSSProperties = {
    backgroundImage: `linear-gradient(${spread}deg, ${color} 0%, ${color} 35%, ${shineColor} 50%, ${color} 65%, ${color} 100%)`,
    backgroundSize: "200% auto",
    backgroundClip: "text",
    WebkitBackgroundClip: "text",
    color: "transparent",
    WebkitTextFillColor: "transparent",
  };

  return (
    <motion.span
      className={cn("inline-block", className)}
      style={{ ...gradientStyle, backgroundPosition }}
      onMouseEnter={pauseOnHover ? () => setPaused(true) : undefined}
      onMouseLeave={pauseOnHover ? () => setPaused(false) : undefined}
    >
      {text}
    </motion.span>
  );
}
