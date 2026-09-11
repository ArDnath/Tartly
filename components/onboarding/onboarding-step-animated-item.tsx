"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { useOnboarding } from "@/components/onboarding/onboarding-provider";
import { ONBOARDING_MOTION_SLIDE_OFFSET } from "@/lib/onboarding/constants";

/**
 * Staggered reveal for a single element inside an onboarding step. Slide
 * direction follows the onboarding navigation direction (forward slides up,
 * backward slides down), mirroring Twenty's `OnboardingStepAnimatedItem`.
 */
export const OnboardingStepAnimatedItem = ({
  index,
  children,
  className,
}: {
  index: number;
  children: ReactNode;
  className?: string;
}) => {
  const { state } = useOnboarding();
  const shouldReduceMotion = useReducedMotion();

  const directionalEnterSlideOffset =
    state.direction === "backward"
      ? -ONBOARDING_MOTION_SLIDE_OFFSET
      : ONBOARDING_MOTION_SLIDE_OFFSET;

  return (
    <motion.div
      className={className}
      initial={{
        opacity: 0,
        y: shouldReduceMotion ? 0 : directionalEnterSlideOffset,
      }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.32,
        ease: "easeInOut",
        delay: shouldReduceMotion ? 0 : index * 0.07,
      }}
    >
      {children}
    </motion.div>
  );
};
