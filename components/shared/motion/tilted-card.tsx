"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useSpring, type HTMLMotionProps } from "motion/react";

import { cn } from "@/lib/utils";

export interface TiltedCardProps extends HTMLMotionProps<"div"> {
  /** Maximum rotation at the corners, in degrees. */
  maxTilt?: number;
  /** Scale applied while the pointer is over the card. */
  hoverScale?: number;
}

const SPRING = { stiffness: 150, damping: 20, mass: 0.6 };

/**
 * React Bits "Tilted Card", generalised to wrap arbitrary content instead of a
 * fixed image. The card leans toward the pointer with a spring, then settles
 * flat. Pointer-fine and motion-safe only.
 */
export function TiltedCard({
  children,
  className,
  maxTilt = 7,
  hoverScale = 1.015,
  ...props
}: TiltedCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const rotateX = useSpring(0, SPRING);
  const rotateY = useSpring(0, SPRING);
  const scale = useSpring(1, SPRING);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduce || event.pointerType !== "mouse") return;
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const offsetX = event.clientX - rect.left - rect.width / 2;
    const offsetY = event.clientY - rect.top - rect.height / 2;
    rotateX.set((offsetY / (rect.height / 2)) * -maxTilt);
    rotateY.set((offsetX / (rect.width / 2)) * maxTilt);
  };

  const reset = () => {
    rotateX.set(0);
    rotateY.set(0);
    scale.set(1);
  };

  return (
    <motion.div
      ref={ref}
      className={cn("will-change-transform [transform-style:preserve-3d]", className)}
      style={{
        rotateX: reduce ? 0 : rotateX,
        rotateY: reduce ? 0 : rotateY,
        scale: reduce ? 1 : scale,
        transformPerspective: 900,
      }}
      onPointerMove={handlePointerMove}
      onPointerEnter={() => {
        if (!reduce) scale.set(hoverScale);
      }}
      onPointerLeave={reset}
      {...props}
    >
      {children}
    </motion.div>
  );
}
