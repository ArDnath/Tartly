"use client";

import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

export interface AuroraProps {
  className?: string;
  /** Three-colour ramp; defaults to the Operator Spectrum (AI-authored signal). */
  colors?: [string, string, string];
  /** Global opacity of the field. */
  intensity?: number;
}

interface Blob {
  color: string;
  left: string;
  top: string;
  size: string;
  duration: number;
  drift: { x: number[]; y: number[]; scale: number[] };
}

/**
 * React Bits "Aurora" without the WebGL cost: three large, heavily blurred
 * colour fields drift against the canvas and blend with `screen`, so they only
 * ever add light. Used behind the hero and closing CTA as the one place the
 * machine spectrum is allowed to breathe. Static under reduced motion.
 */
export function Aurora({
  className,
  colors = ["#ff5e00", "#8a43e1", "#1800e7"],
  intensity = 0.5,
}: AuroraProps) {
  const reduce = useReducedMotion();

  const blobs: Blob[] = [
    {
      color: colors[0],
      left: "-8%",
      top: "-30%",
      size: "48%",
      duration: 20,
      drift: { x: [0, 70, -20, 0], y: [0, 30, 50, 0], scale: [1, 1.15, 0.95, 1] },
    },
    {
      color: colors[1],
      left: "28%",
      top: "-45%",
      size: "58%",
      duration: 26,
      drift: { x: [0, -60, 40, 0], y: [0, 60, 10, 0], scale: [1, 0.92, 1.18, 1] },
    },
    {
      color: colors[2],
      left: "62%",
      top: "-24%",
      size: "52%",
      duration: 23,
      drift: { x: [0, -50, -90, 0], y: [0, 40, -10, 0], scale: [1, 1.12, 0.9, 1] },
    },
  ];

  return (
    <div aria-hidden className={cn("pointer-events-none overflow-hidden", className)}>
      {blobs.map((blob, index) => (
        <motion.div
          key={index}
          className="absolute rounded-full mix-blend-screen blur-3xl"
          style={{
            left: blob.left,
            top: blob.top,
            width: blob.size,
            aspectRatio: "1 / 1",
            opacity: intensity,
            background: `radial-gradient(circle at center, ${blob.color}, transparent 70%)`,
          }}
          animate={reduce ? undefined : { x: blob.drift.x, y: blob.drift.y, scale: blob.drift.scale }}
          transition={{ duration: blob.duration, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}
