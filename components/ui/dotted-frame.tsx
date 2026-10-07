"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

interface DottedFrameProps {
  children: ReactNode;
  className?: string;
}

/**
 * Fades the dot field out toward its outer edge on every side. The linear
 * gradients are composited with `intersect`, so a dot only paints where all
 * layers are opaque — leaving the field solid near the video and dissolving at
 * the frame's outer boundary.
 */
const FADE_STOP = "2.75rem";

/**
 * Progressively dissolves the dots across the lower portion of the frame so
 * the field falls away toward the bottom instead of ending on the hard outer
 * edge. The stops ease the alpha down (rather than a single linear ramp), which
 * reads like a soft blur as the dots disappear. Intersected with the outer
 * fades above, so it also clears the lower half of the side gutters.
 */
const BOTTOM_FADE = [
  "black 42%",
  "rgb(0 0 0 / 0.82) 52%",
  "rgb(0 0 0 / 0.58) 62%",
  "rgb(0 0 0 / 0.34) 72%",
  "rgb(0 0 0 / 0.16) 81%",
  "rgb(0 0 0 / 0.05) 89%",
  "transparent 96%",
].join(", ");

const OUTER_FADE = [
  `linear-gradient(to right, transparent, black ${FADE_STOP}, black calc(100% - ${FADE_STOP}), transparent)`,
  `linear-gradient(to bottom, transparent, black ${FADE_STOP}, black calc(100% - ${FADE_STOP}), transparent)`,
  `linear-gradient(to bottom, ${BOTTOM_FADE})`,
].join(", ");

/**
 * A continuous dot field ringing all four sides of its children, with an
 * accent layer that lights up the dots under the pointer.
 *
 * Ported from portfolio-neo's frame gutters: a muted radial-dot grid sits on
 * the band, and a second grid in the portfolio's accent color is revealed
 * through a soft circle that follows the cursor. Pointer coordinates are
 * written straight to the lit layer as CSS variables, keeping the effect off
 * React's render path.
 *
 * The field is a single absolutely-positioned layer larger than the child on
 * every side, so it reads as one frame around the video rather than four
 * disconnected strips. Linear gradients mask it back toward its outer edge on
 * all four sides and dissolve it across the lower portion; they are composited
 * with `intersect`, and where `mask-composite` is unsupported the field simply
 * renders solid.
 *
 * Used around the hero video section on the landing page.
 */
export function DottedFrame({ children, className }: DottedFrameProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // No hover-capable pointer, nothing to light up.
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const litLayer = root.querySelector<HTMLDivElement>("[data-dot-lit]");
    if (!litLayer) return;

    // The frame only moves on layout changes, so measure once and reuse rather
    // than reading layout on every pointer sample.
    let box = { left: 0, top: 0 };
    const measure = () => {
      const rect = litLayer.getBoundingClientRect();
      box = { left: rect.left, top: rect.top };
    };

    let frame = 0;
    let clientX = 0;
    let clientY = 0;

    const paint = () => {
      frame = 0;
      litLayer.style.setProperty("--dot-x", `${clientX - box.left}px`);
      litLayer.style.setProperty("--dot-y", `${clientY - box.top}px`);
      litLayer.style.setProperty("--dot-lit", "1");
    };

    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(paint);
    };

    const onPointerMove = (event: PointerEvent) => {
      clientX = event.clientX;
      clientY = event.clientY;
      schedule();
    };

    // The cached box is viewport-relative, so any scroll shifts the frame
    // under a stationary pointer. Re-measure and repaint so the lit dots stay
    // under the cursor instead of lagging behind by the scroll distance.
    const onScroll = () => {
      measure();
      if (litLayer.style.getPropertyValue("--dot-lit") === "1") schedule();
    };

    const dim = () => litLayer.style.setProperty("--dot-lit", "0");

    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(root);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    document.documentElement.addEventListener("pointerleave", dim);
    window.addEventListener("blur", dim);

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", onScroll, { capture: true });
      document.documentElement.removeEventListener("pointerleave", dim);
      window.removeEventListener("blur", dim);
    };
  }, []);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-8 sm:-inset-10 lg:-inset-14"
        style={{
          maskImage: OUTER_FADE,
          WebkitMaskImage: OUTER_FADE,
          maskComposite: "intersect",
          WebkitMaskComposite: "source-in",
          maskSize: "100% 100%",
          WebkitMaskSize: "100% 100%",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
        }}
      >
        <div className="landing-dot-grid absolute inset-0" />
        <div data-dot-lit className="landing-dot-grid-lit absolute inset-0" />
      </div>

      {children}
    </div>
  );
}
