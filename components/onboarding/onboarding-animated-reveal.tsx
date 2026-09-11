"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

/** Height-animated reveal used for conditional content inside a step. */
export const OnboardingAnimatedReveal = ({
  isVisible,
  children,
  className,
}: {
  isVisible: boolean;
  children: ReactNode;
  className?: string;
}) => (
  <AnimatePresence initial={false}>
    {isVisible && (
      <motion.div
        className={className}
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.32, ease: "easeInOut" }}
        style={{ overflow: "hidden" }}
      >
        {children}
      </motion.div>
    )}
  </AnimatePresence>
);
