"use client";

import Image from "next/image";

import { cn } from "@/lib/utils";
import logo from "@/public/logo.png";
import { useMemo, type CSSProperties } from "react";

export type MatrixVariant = "scan" | "twinkle" | "orbit" | "pulse";

const CYCLE_MS = 1200;

/**
 * Delay tables per the Transitions.dev spec. Each entry is the --d
 * delay (ms) handed to dot `i` (0–15, row-major in a 4×4 grid).
 */
function delaysFor(variant: MatrixVariant): number[] {
  switch (variant) {
    case "scan":
      // col * cycle/10
      return Array.from({ length: 16 }, (_, i) => (i % 4) * (CYCLE_MS / 10));
    case "twinkle": {
      // order [7,2,11,5,14,9,0,12,3,15,6,10,13,1,8,4] * cycle/16
      const order = [7, 2, 11, 5, 14, 9, 0, 12, 3, 15, 6, 10, 13, 1, 8, 4];
      const delays = new Array<number>(16).fill(0);
      order.forEach((dot, rank) => {
        delays[dot] = rank * (CYCLE_MS / 16);
      });
      return delays;
    }
    case "orbit": {
      // ring [1,2,7,11,14,13,8,4] * cycle/8, centre holds steady (delay 0)
      const ring = [1, 2, 7, 11, 14, 13, 8, 4];
      const delays = new Array<number>(16).fill(0);
      ring.forEach((dot, rank) => {
        delays[dot] = rank * (CYCLE_MS / 8);
      });
      return delays;
    }
    case "pulse": {
      // inner [5,6,9,10] first, the rest cycle*0.16 behind
      const inner = new Set([5, 6, 9, 10]);
      return Array.from({ length: 16 }, (_, i) =>
        inner.has(i) ? 0 : CYCLE_MS * 0.16
      );
    }
  }
}

export function MatrixLoader({
  variant = "scan",
  rounded = false,
  scale = 1,
  className,
}: {
  variant?: MatrixVariant;
  rounded?: boolean;
  scale?: number;
  className?: string;
}) {
  const delays = useMemo(() => delaysFor(variant), [variant]);
  const gaps = rounded ? new Set([0, 3, 12, 15]) : new Set<number>();

  return (
    <div
      role="status"
      aria-label="Loading"
      data-variant={variant}
      className={cn("t-matrix", rounded && "t-matrix--rounded", className)}
      style={{ transform: `scale(${scale})` } as CSSProperties}
    >
      {delays.map((d, i) => (
        <i
          key={i}
          aria-hidden="true"
          className={gaps.has(i) ? "is-gap" : undefined}
          style={{ "--d": Math.round(d) } as CSSProperties}
        />
      ))}
    </div>
  );
}

/**
 * Brand lockup shown beside the loader: the Lunabox logo + wordmark.
 * Colours come from theme tokens so it flips with the dark/light toggle.
 */
export function MatrixBrandMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Image
        src={logo}
        alt="Lunabox logo"
        width={size}
        height={size}
        priority
        className="rounded-lg object-contain"
        style={{ width: size, height: size }}
      />
      <span className="text-2xl font-semibold tracking-[-0.03em]">Lunabox</span>
    </span>
  );
}

/**
 * Full-page boot overlay: a compact MatrixLoader centred on screen,
 * with the Lunabox lockup to its right and an optional label beneath.
 * Parent controls unmount + the `is-leaving` fade via `leaving`.
 */
export function MatrixBootOverlay({
  label,
  variant = "scan",
  leaving = false,
}: {
  label?: string;
  variant?: MatrixVariant;
  leaving?: boolean;
}) {
  return (
    <div
      aria-hidden={leaving}
      className={cn(
        "t-matrix-boot fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-canvas text-canvas-foreground",
        leaving && "is-leaving"
      )}
    >
      <div className="flex items-center gap-4">
        <MatrixLoader variant={variant} scale={2} />
        <span aria-hidden="true" className="h-8 w-px bg-border" />
        <MatrixBrandMark />
      </div>
      {label ? (
        <p className="text-sm font-medium tracking-wide text-muted-foreground">
          {label}
        </p>
      ) : null}
    </div>
  );
}
