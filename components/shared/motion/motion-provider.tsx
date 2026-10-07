"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";

/**
 * Makes every `motion` component in the tree honour the OS "reduce motion"
 * setting: transform/layout animations are skipped while opacity fades remain.
 * Components that ship their own reduced-motion fallback (see components/motion)
 * simply render their settled state and ignore this.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
