'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ElementType,
  type HTMLAttributes,
  type Ref,
} from 'react';
import { motion, useReducedMotion, type MotionProps } from 'motion/react';

import { cn } from '@/lib/utils';

import {
  useVariableProximity,
  type VariableProximityFalloff,
} from './use-variable-proximity';

export type BlurTextDirection = 'top' | 'bottom';
export type BlurTextAnimateBy = 'words' | 'letters';

/** A single motion snapshot — the set of values a unit animates between. */
export type BlurTextSnapshot = Record<string, string | number>;

/**
 * Polymorphic wrapper that accepts the props we forward (a host ref, classes,
 * style, children). Casting the tag to this keeps JSX resolution happy while
 * still rendering whatever intrinsic element `as` names.
 */
type BlurTextTag = ComponentType<HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> }>;

export interface BlurTextProps {
  /** The text content to animate. */
  text?: string;
  /** Delay between animations for each word/letter, in milliseconds. */
  delay?: number;
  /** Extra classes for the rendered element. */
  className?: string;
  /** Split the text into animated words or individual letters. */
  animateBy?: BlurTextAnimateBy;
  /** Direction the words/letters appear from. */
  direction?: BlurTextDirection;
  /** Intersection threshold that triggers the animation. */
  threshold?: number;
  /** Root margin for the intersection observer. */
  rootMargin?: string;
  /** Override the initial (blurred) state. */
  animationFrom?: BlurTextSnapshot;
  /** Override the settled keyframe steps. */
  animationTo?: BlurTextSnapshot[];
  /** Custom easing function applied to every unit. */
  easing?: (t: number) => number;
  /** Fired once the last unit finishes animating. */
  onAnimationComplete?: () => void;
  /** Time taken for each unit to animate, in seconds. */
  stepDuration?: number;
  /** Rendered tag — use `h1`, `h2`, `p`, `span`… Defaults to `p`. */
  as?: ElementType;
  /**
   * Layer the "Variable Proximity" effect on the text once the blur entrance
   * has finished. The letters sit at rest until the last word/letter settles,
   * then thicken toward the cursor.
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

/**
 * Merge the initial snapshot and the keyframe steps into a single keyframe set
 * keyed by CSS/motion property.
 */
const buildKeyframes = (from: BlurTextSnapshot, steps: BlurTextSnapshot[]) => {
  const keys = new Set([...Object.keys(from), ...steps.flatMap((step) => Object.keys(step))]);

  const keyframes: Record<string, (string | number)[]> = {};
  keys.forEach((key) => {
    keyframes[key] = [from[key], ...steps.map((step) => step[key])];
  });
  return keyframes;
};

/**
 * React Bits "Blur Text". Text starts blurred and softly resolves as each word
 * or letter eases in from `direction`, staggered by `delay`.
 *
 * Ported to TypeScript for `components/motion` with an `as` prop so headings
 * keep their semantics instead of always rendering a `<p>`, and a
 * `prefers-reduced-motion` fallback that renders the plain text. When
 * `proximity` is on, each word carries per-letter spans and the cursor effect
 * only switches on after the blur entrance completes.
 */
export function BlurText({
  text = '',
  delay = 200,
  className = '',
  animateBy = 'words',
  direction = 'top',
  threshold = 0.1,
  rootMargin = '0px',
  animationFrom,
  animationTo,
  easing = (t) => t,
  onAnimationComplete,
  stepDuration = 0.35,
  as = 'p',
  proximity = false,
  proximityRadius = 90,
  proximityFrom = "'wght' 500, 'opsz' 9",
  proximityTo = "'wght' 1000, 'opsz' 40",
  proximityFalloff = 'linear',
}: BlurTextProps) {
  const Tag = as as BlurTextTag;
  const reduce = useReducedMotion();
  const elements = animateBy === 'words' ? text.split(' ') : text.split('');
  const [inView, setInView] = useState(false);
  const [proximitySettled, setProximitySettled] = useState(false);
  const ref = useRef<HTMLElement>(null);

  const letterRefs = useVariableProximity({
    containerRef: ref,
    active: proximity && (reduce === true || proximitySettled),
    fromFontVariationSettings: proximityFrom,
    toFontVariationSettings: proximityTo,
    radius: proximityRadius,
    falloff: proximityFalloff,
  });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.unobserve(node);
        }
      },
      { threshold, rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  const defaultFrom = useMemo<BlurTextSnapshot>(
    () =>
      direction === 'top'
        ? { filter: 'blur(10px)', opacity: 0, y: -50 }
        : { filter: 'blur(10px)', opacity: 0, y: 50 },
    [direction],
  );

  const defaultTo = useMemo<BlurTextSnapshot[]>(
    () => [
      {
        filter: 'blur(5px)',
        opacity: 0.5,
        y: direction === 'top' ? 5 : -5,
      },
      { filter: 'blur(0px)', opacity: 1, y: 0 },
    ],
    [direction],
  );

  const handleComplete = () => {
    setProximitySettled(true);
    onAnimationComplete?.();
  };

  if (reduce) {
    return <Tag className={className}>{text}</Tag>;
  }

  const fromSnapshot = animationFrom ?? defaultFrom;
  const toSnapshots = animationTo ?? defaultTo;

  const stepCount = toSnapshots.length + 1;
  const totalDuration = stepDuration * (stepCount - 1);
  const times = Array.from({ length: stepCount }, (_, i) =>
    stepCount === 1 ? 0 : i / (stepCount - 1),
  );

  let letterIndex = 0;

  return (
    <Tag
      ref={ref}
      className={cn(className, proximity && 'variable-proximity')}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        ...(proximity ? { fontVariationSettings: proximityFrom } : null),
      }}
    >
      {elements.map((segment, index) => {
        const animateKeyframes = buildKeyframes(fromSnapshot, toSnapshots);
        const isLast = index === elements.length - 1;

        const spanTransition: MotionProps['transition'] = {
          duration: totalDuration,
          times,
          delay: (index * delay) / 1000,
          ease: easing,
        };

        // Words mode with proximity: keep the word as the animation target and
        // put each letter in its own span so the cursor can weigh them
        // individually.
        if (proximity && animateBy === 'words') {
          const letters = Array.from(segment);
          return (
            <motion.span
              className="inline-block will-change-[transform,filter,opacity]"
              key={index}
              initial={fromSnapshot}
              animate={(inView ? animateKeyframes : fromSnapshot) as MotionProps['animate']}
              transition={spanTransition}
              onAnimationComplete={isLast ? handleComplete : undefined}
            >
              {letters.map((letter, letterPosition) => {
                const currentLetterIndex = letterIndex++;
                return (
                  <span
                    key={letterPosition}
                    className="inline-block"
                    aria-hidden="true"
                    ref={(el) => {
                      letterRefs.current[currentLetterIndex] = el;
                    }}
                  >
                    {letter === ' ' ? '\u00A0' : letter}
                  </span>
                );
              })}
              {index < elements.length - 1 && '\u00A0'}
            </motion.span>
          );
        }

        return (
          <motion.span
            className="inline-block will-change-[transform,filter,opacity]"
            key={index}
            ref={
              proximity
                ? (el) => {
                    letterRefs.current[index] = el;
                  }
                : undefined
            }
            initial={fromSnapshot}
            animate={(inView ? animateKeyframes : fromSnapshot) as MotionProps['animate']}
            transition={spanTransition}
            onAnimationComplete={isLast ? handleComplete : undefined}
          >
            {segment === ' ' ? '\u00A0' : segment}
            {animateBy === 'words' && index < elements.length - 1 && '\u00A0'}
          </motion.span>
        );
      })}
    </Tag>
  );
}

export default BlurText;
