"use client";

import {
  Fragment,
  useRef,
  useState,
  type ComponentType,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { motion, useInView, useReducedMotion, type MotionProps } from "motion/react";

import {
  useVariableProximity,
  type VariableProximityFalloff,
} from "./use-variable-proximity";

/** Initial / settled animation target accepted by `motion`. */
type MotionTarget = Exclude<NonNullable<MotionProps["initial"]>, boolean | string | string[]>;

export type StaggeredTextSegment = "chars" | "words" | "lines";
export type StaggeredTextDirection = "top" | "bottom" | "left" | "right";
export type StaggeredTextStaggerDirection = "forward" | "reverse" | "center";

/** Cubic-bezier or a plain easing function — the two forms used on the site. */
export type StaggeredTextEasing =
  | [number, number, number, number]
  | ((t: number) => number);

export interface StaggeredTextProps {
  /** The text content to animate with the staggered effect. */
  text?: string;
  /** Additional classes applied to the outer element. */
  className?: string;
  /** The HTML element to render as. */
  as?: ElementType;
  /** How to split the text into animated segments. */
  segmentBy?: StaggeredTextSegment;
  /** Split the text into rows on this string before segmenting. */
  separator?: string;
  /** Delay between each segment, in milliseconds. */
  delay?: number;
  /** Seconds to wait before the first segment starts. */
  startDelay?: number;
  /** Duration of one segment's animation, in seconds. */
  duration?: number;
  /** Easing applied to every segment (single or per-keyframe). */
  easing?: StaggeredTextEasing | StaggeredTextEasing[];
  /** Fraction of the element that must be visible to trigger. */
  threshold?: number;
  /** IntersectionObserver root margin for the scroll trigger. */
  rootMargin?: string;
  /** Direction the segments travel in from. */
  direction?: StaggeredTextDirection;
  /** Blur the segments as they settle. */
  blur?: boolean;
  /** Order in which segments animate: forward, reverse, or center-out. */
  staggerDirection?: StaggeredTextStaggerDirection;
  /** Respect the user's `prefers-reduced-motion` setting. */
  respectReducedMotion?: boolean;
  /** Animate back out when the block scrolls out of view. */
  exitOnScrollOut?: boolean;
  /** Override the default initial state. */
  from?: MotionTarget;
  /** Override the default settled state. */
  to?: MotionTarget | MotionTarget[];
  /** Fired once the last segment has settled. */
  onAnimationComplete?: () => void;
  /** Fired once the exit animation completes. */
  onExitComplete?: () => void;
  /**
   * Animate when the block scrolls into view (default). Pass `false` for
   * above-the-fold hero copy so it animates on mount with no dead frame.
   * Mirrors the local `SplitText` convention.
   */
  inView?: boolean;
  /**
   * Layer the "Variable Proximity" effect on the text once the staggered
   * entrance finishes. Only takes effect with `segmentBy="words"`.
   */
  proximity?: boolean;
  /** Proximity radius, in pixels. */
  proximityRadius?: number;
  /** Resting variation settings for the proximity effect. */
  proximityFrom?: string;
  /** Variation settings reached under the cursor. */
  proximityTo?: string;
  /** Proximity falloff curve. */
  proximityFalloff?: VariableProximityFalloff;
}

/** Polymorphic tag cast, mirroring `BlurText`, so JSX resolution stays happy. */
type StaggeredTextTag = ComponentType<HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> }>;

/** Matches the signature ease used by the rest of `components/motion`. */
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const OFFSET: Record<StaggeredTextDirection, MotionTarget> = {
  top: { y: "-0.7em" },
  bottom: { y: "0.7em" },
  left: { x: "-0.7em" },
  right: { x: "0.7em" },
};

/**
 * React Bits "Staggered Text", rebuilt locally on `motion/react` — the Pro
 * registry variant (`@reactbits-starter/staggered-text-tw`) needs a paid
 * license key, so this mirrors its documented props without the dependency.
 *
 * The string is split into words, characters, or lines and each segment eases
 * in from `direction` with an optional blur. Blocks below the fold trigger on
 * scroll via IntersectionObserver; hero copy passes `inView={false}` to run on
 * mount instead. The accessible string renders once in a screen-reader-only
 * node while the animated segments stay `aria-hidden`, so headings read cleanly.
 * Reduced motion renders the plain tag with no wrappers at all.
 *
 * With `proximity`, each word also carries per-letter spans and the cursor
 * effect only switches on once the last segment has settled.
 */
export function StaggeredText({
  text = "",
  className,
  as = "p",
  segmentBy = "words",
  separator,
  delay = 80,
  startDelay = 0,
  duration = 0.6,
  easing = EASE,
  threshold = 0.1,
  rootMargin = "0px",
  direction = "top",
  blur = true,
  staggerDirection = "forward",
  respectReducedMotion = true,
  exitOnScrollOut = false,
  from,
  to,
  onAnimationComplete,
  onExitComplete,
  inView = true,
  proximity = false,
  proximityRadius = 90,
  proximityFrom = "'wght' 500, 'opsz' 9",
  proximityTo = "'wght' 1000, 'opsz' 40",
  proximityFalloff = "linear",
}: StaggeredTextProps) {
  const Tag = as as StaggeredTextTag;
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const [proximitySettled, setProximitySettled] = useState(false);

  // `once` is disabled only when we need to animate back out on scroll away.
  const entered = useInView(ref, {
    once: !exitOnScrollOut,
    amount: threshold,
    margin: rootMargin as `${number}px`,
  });

  const letterRefs = useVariableProximity({
    containerRef: ref,
    active: proximity && (reduce === true || proximitySettled),
    fromFontVariationSettings: proximityFrom,
    toFontVariationSettings: proximityTo,
    radius: proximityRadius,
    falloff: proximityFalloff,
  });

  if (respectReducedMotion && reduce) {
    return <Tag className={className}>{text}</Tag>;
  }

  const active = inView === false ? true : entered;

  const rows = separator
    ? text.split(separator)
    : segmentBy === "lines"
      ? text.split("\n")
      : [text];

  const total = rows.reduce((count, row) => {
    if (segmentBy === "lines") return count + 1;
    if (segmentBy === "chars") return count + Array.from(row).filter((char) => char !== " ").length;
    return count + row.split(" ").filter(Boolean).length;
  }, 0);

  if (total === 0) {
    return <Tag className={className}>{text}</Tag>;
  }

  const step = delay / 1000;

  const rank = (index: number) => {
    if (staggerDirection === "reverse") return total - 1 - index;
    if (staggerDirection === "center") {
      const middle = (total - 1) / 2;
      return Math.round(Math.abs(index - middle));
    }
    return index;
  };

  const ranks = Array.from({ length: total }, (_, index) => rank(index));
  const maxRank = Math.max(...ranks);
  const lastIndex = ranks.lastIndexOf(maxRank);

  const hidden: MotionTarget = {
    opacity: 0,
    ...OFFSET[direction],
    ...(blur ? { filter: "blur(8px)" } : {}),
    ...from,
  };

  const settled: MotionTarget = {
    opacity: 1,
    x: 0,
    y: 0,
    ...(blur ? { filter: "blur(0px)" } : {}),
  };

  const target = to ?? settled;

  const handleComplete = () => {
    if (active) {
      setProximitySettled(true);
      onAnimationComplete?.();
    } else {
      onExitComplete?.();
    }
  };

  let cursor = 0;
  const next = () => cursor++;
  let letterIndex = 0;

  const renderSegment = (index: number, content: ReactNode, key: React.Key) => (
    <motion.span
      key={key}
      data-reveal
      className="inline-block will-change-transform"
      initial={hidden}
      animate={(active ? target : hidden) as MotionProps["animate"]}
      transition={{ duration, ease: easing, delay: startDelay + rank(index) * step }}
      onAnimationComplete={index === lastIndex ? handleComplete : undefined}
    >
      {content}
    </motion.span>
  );

  /** Wrap a word's characters in spans the cursor effect can measure. */
  const renderWordLetters = (word: string) => (
    <>
      {Array.from(word).map((char, charIndex) => {
        const index = letterIndex++;
        return (
          <span
            key={charIndex}
            aria-hidden="true"
            className="inline-block"
            ref={(el) => {
              letterRefs.current[index] = el;
            }}
          >
            {char}
          </span>
        );
      })}
    </>
  );

  const renderRow = (row: string, rowIndex: number): ReactNode => {
    if (segmentBy === "lines") {
      const index = next();
      return (
        <Fragment key={rowIndex}>
          {renderSegment(index, row, `${rowIndex}-0`)}
          {rowIndex < rows.length - 1 ? <br /> : null}
        </Fragment>
      );
    }

    const words = row.split(" ");

    if (segmentBy === "chars") {
      return (
        <Fragment key={rowIndex}>
          {words.map((word, wordIndex) => (
            <Fragment key={wordIndex}>
              <span className="inline-block whitespace-nowrap">
                {Array.from(word).map((char, charIndex) => {
                  const index = next();
                  return renderSegment(index, char, `${rowIndex}-${wordIndex}-${charIndex}`);
                })}
              </span>
              {wordIndex < words.length - 1 ? " " : null}
            </Fragment>
          ))}
          {rowIndex < rows.length - 1 ? <br /> : null}
        </Fragment>
      );
    }

    const visibleWords = words.filter(Boolean);
    return (
      <Fragment key={rowIndex}>
        {visibleWords.map((word, wordIndex) => {
          const index = next();
          return (
            <Fragment key={wordIndex}>
              {renderSegment(index, proximity ? renderWordLetters(word) : word, `${rowIndex}-${wordIndex}`)}
              {wordIndex < visibleWords.length - 1 ? " " : null}
            </Fragment>
          );
        })}
        {rowIndex < rows.length - 1 ? <br /> : null}
      </Fragment>
    );
  };

  return (
    <Tag
      ref={ref}
      className={`${className ?? ""} ${proximity ? "variable-proximity" : ""}`.trim()}
      style={proximity ? { fontVariationSettings: proximityFrom } : undefined}
    >
      <span className="sr-only">{text}</span>
      <motion.span aria-hidden className="inline">
        {rows.map(renderRow)}
      </motion.span>
    </Tag>
  );
}
