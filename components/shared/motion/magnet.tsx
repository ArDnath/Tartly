"use client";

import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import { useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

export interface MagnetProps extends HTMLAttributes<HTMLDivElement> {
  /** Larger values mean a subtler pull (cursor offset is divided by this). */
  strength?: number;
  /** Extra px around the element where the pull begins to apply. */
  padding?: number;
  disabled?: boolean;
}

/**
 * React Bits "Magnet": the wrapped element leans toward the cursor while it is
 * nearby, then springs home. Only armed for fine, hover-capable pointers and
 * never under reduced motion, so touch devices are untouched.
 */
export function Magnet({
  children,
  className,
  strength = 7,
  padding = 90,
  disabled = false,
  ...props
}: MagnetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (disabled || reduce) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const onPointerMove = (event: PointerEvent) => {
      const node = ref.current;
      if (!node) return;
      const { left, top, width, height } = node.getBoundingClientRect();
      const centerX = left + width / 2;
      const centerY = top + height / 2;
      const distX = Math.abs(centerX - event.clientX);
      const distY = Math.abs(centerY - event.clientY);

      if (distX < width / 2 + padding && distY < height / 2 + padding) {
        setActive(true);
        setPosition({
          x: (event.clientX - centerX) / strength,
          y: (event.clientY - centerY) / strength,
        });
      } else if (active) {
        setActive(false);
        setPosition({ x: 0, y: 0 });
      }
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [active, disabled, padding, reduce, strength]);

  return (
    <div
      ref={ref}
      className={cn("inline-block will-change-transform", className)}
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        transition: active
          ? "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)"
          : "transform 0.5s ease-in-out",
      }}
      {...props}
    >
      {children}
    </div>
  );
}
