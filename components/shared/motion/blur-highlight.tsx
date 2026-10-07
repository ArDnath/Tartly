"use client";

import { Fragment, useRef, type ReactNode } from "react";
import { motion, useInView, useReducedMotion, type Variants } from "motion/react";

import { cn } from "@/lib/utils";

export interface HighlightBit {
  /** Substring to highlight. */
  text: string;
  /** 1-based occurrence to mark; omit to highlight every occurrence. */
  occurrence?: number;
}

export type HighlightDirection = "left" | "right" | "top" | "bottom";

export interface BlurHighlightProps {
  children: ReactNode;
  /** Strings (all occurrences) or `{ text, occurrence }` for one match. */
  highlightedBits?: (string | HighlightBit)[];
  /** Any CSS color for the highlight wash. */
  highlightColor?: string;
  /** Extra classes on highlighted spans (e.g. `text-white`). */
  highlightClassName?: string;
  /** Initial blur radius in px. */
  blurAmount?: number;
  /** Paragraph opacity before it enters view. */
  inactiveOpacity?: number;
  /** Seconds before the blur-in starts. */
  blurDelay?: number;
  /** Blur-in length in seconds. */
  blurDuration?: number;
  /** Seconds before the highlight sweep starts. */
  highlightDelay?: number;
  /** Highlight sweep length in seconds. */
  highlightDuration?: number;
  /** Where the highlight sweeps in from. */
  highlightDirection?: HighlightDirection;
  /** Intersection options (root margin is fixed at -20%). */
  viewportOptions?: { once?: boolean; amount?: number };
  /**
   * Animate on mount instead of on scroll. Above-the-fold hero copy uses this
   * so there is no dead frame before the first paint.
   */
  inView?: boolean;
  className?: string;
}

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const ORIGIN: Record<HighlightDirection, string> = {
  left: "left center",
  right: "right center",
  top: "center top",
  bottom: "center bottom",
};

interface Segment {
  text: string;
  highlight: boolean;
}

/**
 * Split a plain string into highlighted and plain runs. Overlapping matches are
 * merged so a phrase never gets two washes stacked on top of each other.
 */
function buildSegments(text: string, bits: (string | HighlightBit)[]): Segment[] {
  const ranges: { start: number; end: number }[] = [];

  for (const bit of bits) {
    const value = typeof bit === "string" ? bit : bit.text;
    if (!value) continue;
    const occurrence = typeof bit === "string" ? undefined : bit.occurrence;

    const found: number[] = [];
    let from = 0;
    while (from <= text.length - value.length) {
      const index = text.indexOf(value, from);
      if (index === -1) break;
      found.push(index);
      from = index + value.length;
    }

    const chosen =
      occurrence != null ? (found[occurrence - 1] != null ? [found[occurrence - 1]] : []) : found;
    for (const index of chosen) ranges.push({ start: index, end: index + value.length });
  }

  ranges.sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }

  const segments: Segment[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) {
      segments.push({ text: text.slice(cursor, range.start), highlight: false });
    }
    segments.push({ text: text.slice(range.start, range.end), highlight: true });
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlight: false });

  return segments;
}

/**
 * React Bits "Blur Highlight", rebuilt locally on `motion/react` — the Pro
 * registry variant needs a paid license key, so this mirrors its documented
 * props without the dependency.
 *
 * The paragraph blurs in once, then each `highlightedBits` phrase gets a
 * marker-like wash that sweeps in from `highlightDirection`. Reduced motion
 * renders the settled paragraph — blur removed, highlights already drawn — with
 * no motion wrappers at all.
 *
 * The accessible string is rendered inline (no per-word splitting), so screen
 * readers read the copy as a normal paragraph while the decorative wash layers
 * stay `aria-hidden`.
 */
export function BlurHighlight({
  children,
  highlightedBits = [],
  highlightColor = "hsl(80, 100%, 50%)",
  highlightClassName,
  blurAmount = 8,
  inactiveOpacity = 0.3,
  blurDelay = 0,
  blurDuration = 0.8,
  highlightDelay = 0.4,
  highlightDuration = 1,
  highlightDirection = "left",
  viewportOptions = { once: false, amount: 0.5 },
  inView = true,
  className,
}: BlurHighlightProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLParagraphElement>(null);
  const entered = useInView(ref, {
    once: viewportOptions.once,
    amount: viewportOptions.amount,
    margin: "0px 0px -20% 0px",
  });
  const active = !inView || entered;

  const segments = typeof children === "string" ? buildSegments(children, highlightedBits) : null;
  const horizontal = highlightDirection === "left" || highlightDirection === "right";

  if (reduce) {
    return (
      <p ref={ref} className={className}>
        {segments
          ? segments.map((segment, index) =>
              segment.highlight ? (
                <span
                  key={index}
                  className={cn(
                    "relative inline-block -mx-1 rounded-[3px] px-1 [box-decoration-break:clone]",
                    highlightClassName,
                  )}
                >
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-[3px]"
                    style={{ backgroundColor: highlightColor }}
                  />
                  <span className="relative">{segment.text}</span>
                </span>
              ) : (
                <Fragment key={index}>{segment.text}</Fragment>
              ),
            )
          : children}
      </p>
    );
  }

  const container: Variants = {
    hidden: { opacity: inactiveOpacity, filter: `blur(${blurAmount}px)` },
    visible: {
      opacity: 1,
      filter: "blur(0px)",
      transition: { duration: blurDuration, delay: blurDelay, ease: EASE },
    },
  };

  const wash: Variants = {
    hidden: {
      scaleX: horizontal ? 0 : 1,
      scaleY: horizontal ? 1 : 0,
    },
    visible: {
      scaleX: 1,
      scaleY: 1,
      transition: { duration: highlightDuration, delay: highlightDelay, ease: EASE },
    },
  };

  return (
    <motion.p
      ref={ref}
      data-reveal
      className={cn(className)}
      initial="hidden"
      animate={active ? "visible" : "hidden"}
      variants={container}
    >
      {segments
        ? segments.map((segment, index) =>
            segment.highlight ? (
              <span
                key={index}
                className={cn(
                  "relative inline-block -mx-1 rounded-[3px] px-1 [box-decoration-break:clone]",
                  highlightClassName,
                )}
              >
                <motion.span
                  aria-hidden
                  data-reveal
                  variants={wash}
                  className="absolute inset-0 rounded-[3px]"
                  style={{
                    backgroundColor: highlightColor,
                    transformOrigin: ORIGIN[highlightDirection],
                  }}
                />
                <span className="relative">{segment.text}</span>
              </span>
            ) : (
              <Fragment key={index}>{segment.text}</Fragment>
            ),
          )
        : children}
    </motion.p>
  );
}
