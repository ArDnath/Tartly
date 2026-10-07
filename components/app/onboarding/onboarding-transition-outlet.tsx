"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { ONBOARDING_MOTION_SLIDE_OFFSET } from "@/lib/onboarding/constants";
import type { OnboardingNavigationDirection } from "@/lib/onboarding/types";

/**
 * Slide/fade transition between onboarding steps. Forward navigations exit
 * upward, backward navigations exit downward — the same directional feel as
 * Twenty's `OnboardingTransitionOutlet`, but driven by our state machine key.
 */
export const OnboardingTransitionOutlet = ({
  stepKey,
  direction,
  children,
}: {
  stepKey: string;
  direction: OnboardingNavigationDirection;
  children: ReactNode;
}) => {
  const shouldReduceMotion = useReducedMotion();

  const exitSlideOffset = shouldReduceMotion
    ? 0
    : direction === "backward"
      ? ONBOARDING_MOTION_SLIDE_OFFSET
      : -ONBOARDING_MOTION_SLIDE_OFFSET;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <AnimatePresence mode="wait" custom={exitSlideOffset} initial={false}>
        <motion.div
          key={stepKey}
          custom={exitSlideOffset}
          className="absolute inset-0 flex min-h-0 min-w-0 flex-col"
          initial={{ opacity: 0, y: shouldReduceMotion ? 0 : -exitSlideOffset }}
          animate={{ opacity: 1, y: 0 }}
          exit={{
            opacity: 0,
            y: exitSlideOffset,
            pointerEvents: "none",
          }}
          transition={{ duration: 0.32, ease: "easeInOut" }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
