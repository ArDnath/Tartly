"use client";

import { useCallback, useEffect, useRef, type HTMLAttributes } from "react";
import { useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

interface Spark {
  x: number;
  y: number;
  angle: number;
  startTime: number;
}

export interface ClickSparkProps extends HTMLAttributes<HTMLDivElement> {
  color?: string;
  /** Length of each spark line, in px. */
  size?: number;
  /** How far sparks travel before fading. */
  radius?: number;
  count?: number;
  /** Spark lifetime in ms. */
  duration?: number;
}

const EASE = (t: number) => t * (2 - t);

/**
 * React Bits "Click Spark": a burst of short lines fires from the pointer on
 * click, drawn on a transparent canvas above the children. A no-op under
 * reduced motion, and the canvas is `pointer-events-none` so links below it
 * keep working.
 */
export function ClickSpark({
  children,
  className,
  color = "#ffffff",
  size = 8,
  radius = 16,
  count = 8,
  duration = 420,
  ...props
}: ClickSparkProps) {
  const reduce = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparksRef = useRef<Spark[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || reduce) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const { width, height } = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, width * dpr);
      canvas.height = Math.max(1, height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);

    let frame = 0;
    const draw = (timestamp: number) => {
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);

      sparksRef.current = sparksRef.current.filter((spark) => {
        const elapsed = timestamp - spark.startTime;
        if (elapsed >= duration) return false;

        const progress = EASE(elapsed / duration);
        const distance = progress * radius;
        const lineLength = size * (1 - progress);
        const x1 = spark.x + distance * Math.cos(spark.angle);
        const y1 = spark.y + distance * Math.sin(spark.angle);
        const x2 = spark.x + (distance + lineLength) * Math.cos(spark.angle);
        const y2 = spark.y + (distance + lineLength) * Math.sin(spark.angle);

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        return true;
      });

      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [color, duration, radius, reduce, size]);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (reduce) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const now = performance.now();
      sparksRef.current.push(
        ...Array.from({ length: count }, (_, index) => ({
          x,
          y,
          angle: (2 * Math.PI * index) / count,
          startTime: now,
        })),
      );
    },
    [count, reduce],
  );

  return (
    <div className={cn("relative", className)} onClick={handleClick} {...props}>
      {!reduce ? (
        <canvas
          ref={canvasRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full"
        />
      ) : null}
      {children}
    </div>
  );
}
