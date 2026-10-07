"use client";

import { Fragment, type JSX } from "react";
import { motion, useReducedMotion, type Variants } from "motion/react";

import { cn } from "@/lib/utils";

export interface SplitTextFrom {
  y?: number;
  x?: number;
  opacity?: number;
  blur?: number;
  rotateX?: number;
  scale?: number;
}

export interface SplitTextProps {
  text: string;
  /** Rendered tag — use `h1`, `h2`, `p`, `span`… Defaults to `span`. */
  as?: keyof JSX.IntrinsicElements;
  className?: string;
  splitBy?: "words" | "chars";
  /** Stagger between units, in seconds. */
  stagger?: number;
  /** Per-unit tween length, in seconds. */
  duration?: number;
  /** Seconds before the first unit starts. */
  delay?: number;
  from?: SplitTextFrom;
  /** Animate when scrolled into view (default) or on mount for above-fold copy. */
  inView?: boolean;
  once?: boolean;
  amount?: number;
}

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * React Bits "Split Text" adapted to `motion/react` (no GSAP dependency).
 *
 * The accessible string is rendered once in a screen-reader-only node and the
 * animated units are hidden from assistive tech, so headings read cleanly while
 * still animating word- or character-by-character. Reduced motion renders the
 * plain tag with no wrappers at all.
 */
export function SplitText({
  text,
  as,
  className,
  splitBy = "words",
  stagger = 0.055,
  duration = 0.7,
  delay = 0,
  from,
  inView = true,
  once = true,
  amount = 0.3,
}: SplitTextProps) {
  const reduce = useReducedMotion();

  // The intrinsic-tag union collapses JSX props to `never` under the React 19
  // types; the cast pins a concrete tag for the checker while the runtime value
  // (whatever the caller passed to `as`) still renders.
  const Tag = (as ?? "span") as "span";

  if (reduce) {
    return <Tag className={className}>{text}</Tag>;
  }

  const source: Required<SplitTextFrom> = {
    y: 24,
    x: 0,
    opacity: 0,
    blur: 0,
    rotateX: 0,
    scale: 1,
    ...from,
  };

  const container: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: stagger, delayChildren: delay } },
  };

  const unit: Variants = {
    hidden: {
      opacity: source.opacity,
      y: source.y,
      x: source.x,
      scale: source.scale,
      rotateX: source.rotateX,
      ...(source.blur ? { filter: `blur(${source.blur}px)` } : {}),
    },
    visible: {
      opacity: 1,
      y: 0,
      x: 0,
      scale: 1,
      rotateX: 0,
      ...(source.blur ? { filter: "blur(0px)" } : {}),
      transition: { duration, ease: EASE },
    },
  };

  const words = text.split(" ");

  const content =
    splitBy === "chars" ? (
      words.map((word, wordIndex) => (
        <Fragment key={`${word}-${wordIndex}`}>
          <span className="inline-block whitespace-nowrap">
            {Array.from(word).map((char, charIndex) => (
              <motion.span
                key={charIndex}
                data-reveal
                variants={unit}
                className="inline-block will-change-transform"
              >
                {char}
              </motion.span>
            ))}
          </span>
          {wordIndex < words.length - 1 ? " " : null}
        </Fragment>
      ))
    ) : (
      words.map((word, wordIndex) => (
        <Fragment key={`${word}-${wordIndex}`}>
          <motion.span data-reveal variants={unit} className="inline-block will-change-transform">
            {word}
          </motion.span>
          {wordIndex < words.length - 1 ? " " : null}
        </Fragment>
      ))
    );

  const viewProps = inView
    ? {
        whileInView: "visible" as const,
        viewport: { once, amount, margin: "0px 0px -8% 0px" as const },
      }
    : { animate: "visible" as const };

  return (
    <Tag className={className}>
      <span className="sr-only">{text}</span>
      <motion.span
        aria-hidden
        variants={container}
        initial="hidden"
        {...viewProps}
        className={cn("inline", inView && "block")}
      >
        {content}
      </motion.span>
    </Tag>
  );
}
