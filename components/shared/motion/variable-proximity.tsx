"use client";

import {
  forwardRef,
  type HTMLAttributes,
  type RefObject,
} from "react";
import { motion } from "motion/react";
import {
  useVariableProximity,
  type VariableProximityFalloff,
} from "./use-variable-proximity";
import "./variable-proximity.css";

export type { VariableProximityFalloff };

/** Stable fallback so callers that omit `containerRef` don't re-observe each render. */
const NO_CONTAINER = { current: null } as RefObject<HTMLElement | null>;

export interface VariableProximityProps extends HTMLAttributes<HTMLSpanElement> {
  /** The text content to display. */
  label?: string;
  /** The starting variation settings. */
  fromFontVariationSettings?: string;
  /** The variation settings to reach at cursor proximity. */
  toFontVariationSettings?: string;
  /** Reference to the container used for relative cursor calculations. */
  containerRef?: RefObject<HTMLElement | null>;
  /** Proximity radius that influences the effect, in pixels. */
  radius?: number;
  /** Type of falloff applied as the cursor moves away from a letter. */
  falloff?: VariableProximityFalloff;
  /**
   * Gate for the effect. While `false` the letters stay at the resting
   * variation so an entrance / scroll animation can finish first; flip it to
   * `true` (usually via `onAnimationComplete`) to hand control to the cursor.
   */
  active?: boolean;
}

/**
 * React Bits "Variable Proximity" — each letter's variable-font axes are
 * interpolated from `fromFontVariationSettings` to `toFontVariationSettings`
 * based on the cursor's distance, so text thickens as the pointer passes over
 * it. The animated letters stay `aria-hidden`; the label renders once in a
 * screen-reader-only node so the heading still reads cleanly.
 *
 * Uses the shared `useVariableProximity` engine so the same effect can be
 * layered onto other text animation components (Blur Text, Scroll Float,
 * Staggered Text) behind a settle gate.
 */
const VariableProximity = forwardRef<HTMLSpanElement, VariableProximityProps>(
  (props, ref) => {
    const {
      label = "",
      fromFontVariationSettings = "'wght' 400, 'opsz' 9",
      toFontVariationSettings = "'wght' 800, 'opsz' 40",
      containerRef,
      radius = 50,
      falloff = "linear",
      active = true,
      className = "",
      onClick,
      style,
      ...restProps
    } = props;

    const letterRefs = useVariableProximity({
      containerRef: containerRef ?? NO_CONTAINER,
      active,
      fromFontVariationSettings,
      toFontVariationSettings,
      radius,
      falloff,
    });

    const words = label.split(" ");
    let letterIndex = 0;

    return (
      <span
        ref={ref}
        className={`${className} variable-proximity`}
        onClick={onClick}
        style={{
          display: "inline",
          fontVariationSettings: fromFontVariationSettings,
          ...style,
        }}
        {...restProps}
      >
        {words.map((word, wordIndex) => (
          <span key={wordIndex} style={{ display: "inline-block", whiteSpace: "nowrap" }}>
            {word.split("").map((letter) => {
              const currentLetterIndex = letterIndex++;
              return (
                <motion.span
                  key={currentLetterIndex}
                  ref={(el) => {
                    letterRefs.current[currentLetterIndex] = el;
                  }}
                  style={{ display: "inline-block" }}
                  aria-hidden="true"
                >
                  {letter}
                </motion.span>
              );
            })}
            {wordIndex < words.length - 1 && (
              <span style={{ display: "inline-block" }}>&nbsp;</span>
            )}
          </span>
        ))}
        <span className="sr-only">{label}</span>
      </span>
    );
  },
);

VariableProximity.displayName = "VariableProximity";
export default VariableProximity;
