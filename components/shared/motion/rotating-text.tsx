"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

export interface RotatingTextProps {
  texts: string[];
  className?: string;
  /** Milliseconds each phrase stays on screen. */
  interval?: number;
  pauseOnHover?: boolean;
}

/**
 * React Bits "Rotating Text": one phrase slides out as the next slides in,
 * inside a clipping box so nothing spills into neighbouring lines. Reduced
 * motion keeps the first phrase and skips the interval entirely.
 */
export function RotatingText({
  texts,
  className,
  interval = 2200,
  pauseOnHover = false,
}: RotatingTextProps) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (reduce || paused || texts.length < 2) return;
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % texts.length);
    }, interval);
    return () => window.clearInterval(id);
  }, [interval, paused, reduce, texts.length]);

  return (
    <span
      className={cn("relative inline-flex overflow-hidden align-bottom", className)}
      onMouseEnter={pauseOnHover ? () => setPaused(true) : undefined}
      onMouseLeave={pauseOnHover ? () => setPaused(false) : undefined}
    >
      <span className="sr-only">{texts.join(", ")}</span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={index}
          aria-hidden
          className="inline-block"
          initial={reduce ? false : { y: "0.85em", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? undefined : { y: "-0.85em", opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          {texts[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
