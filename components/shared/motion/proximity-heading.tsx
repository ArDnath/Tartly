"use client";

import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import VariableProximity, {
  type VariableProximityFalloff,
} from "./variable-proximity";

/** Matches the signature ease used by the rest of `components/motion`. */
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Heading tags this wrapper can render. */
export type ProximityHeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span" | "div";

export interface ProximityHeadingProps {
  /** The heading text. */
  label: string;
  /** Heading tag to render (`h1`, `h2`, `h3`, …). */
  as?: ProximityHeadingTag;
  /** Classes for the heading tag itself. */
  className?: string;
  /** Classes for the inner proximity container. */
  wrapperClassName?: string;
  /** Proximity radius, in pixels. Scale with the heading size. */
  radius?: number;
  /** The starting variation settings (resting weight). */
  fromFontVariationSettings?: string;
  /** The variation settings reached under the cursor. */
  toFontVariationSettings?: string;
  /** Proximity falloff curve. */
  falloff?: VariableProximityFalloff;
  /** Animate on mount (above the fold) instead of on scroll. */
  inView?: boolean;
  /** Seconds before the entrance starts. */
  startDelay?: number;
  /** Entrance length in seconds. */
  duration?: number;
}

/**
 * A heading whose letters interpolate their variable-font axes toward the
 * cursor — the React Bits "Variable Proximity" effect with the heading's
 * entrance and semantics layered on top.
 *
 * The wrapper `<span>` is both the entrance target and the proximity container,
 * so a single element per heading runs the effect. Critically, the proximity
 * loop is gated: it stays off while the entrance plays and only switches on in
 * `onAnimationComplete`, so the settling text is never fighting the cursor
 * effect. `data-reveal` lets the no-JS / print / reduced-motion rules settle it,
 * and the resting weight is applied as an inline font-variation default so
 * there is no thin flash before the first animation frame.
 */
export function ProximityHeading({
  label,
  as: Tag = "h2",
  className,
  wrapperClassName,
  radius = 120,
  fromFontVariationSettings = "'wght' 600, 'opsz' 9",
  toFontVariationSettings = "'wght' 1000, 'opsz' 40",
  falloff = "linear",
  inView = true,
  startDelay = 0,
  duration = 0.7,
}: ProximityHeadingProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  // The proximity effect stays parked until the entrance animation reports it
  // has finished, so the two never run over each other.
  const [settled, setSettled] = useState(false);

  const hidden = { opacity: 0, y: 16, filter: "blur(6px)" };
  const visible = { opacity: 1, y: 0, filter: "blur(0px)" };

  const proximity = (
    <VariableProximity
      label={label}
      containerRef={containerRef}
      radius={radius}
      fromFontVariationSettings={fromFontVariationSettings}
      toFontVariationSettings={toFontVariationSettings}
      falloff={falloff}
      active={reduce ? true : settled}
    />
  );

  if (reduce) {
    return (
      <Tag className={className}>
        <span
          ref={containerRef}
          data-reveal
          className={wrapperClassName}
          style={{ display: "inline-block", fontVariationSettings: fromFontVariationSettings }}
        >
          {proximity}
        </span>
      </Tag>
    );
  }

  return (
    <Tag className={className}>
      <motion.span
        ref={containerRef}
        data-reveal
        className={wrapperClassName}
        style={{ display: "inline-block", fontVariationSettings: fromFontVariationSettings }}
        initial={hidden}
        {...(inView === false
          ? { animate: visible }
          : { whileInView: visible, viewport: { once: true, amount: 0.4 } })}
        transition={{ duration, delay: startDelay, ease: EASE }}
        onAnimationComplete={() => setSettled(true)}
      >
        {proximity}
      </motion.span>
    </Tag>
  );
}

export default ProximityHeading;
