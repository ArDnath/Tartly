"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";

/** Proximity falloff curve between the cursor and each letter. */
export type VariableProximityFalloff = "linear" | "exponential" | "gaussian";

export interface UseVariableProximityOptions {
  /** Container whose box is the origin for the proximity math. */
  containerRef: RefObject<HTMLElement | null>;
  /**
   * Gate for the effect. While `false` the animation loop is stopped and the
   * letters are pinned to their resting variation, so entrance / scroll
   * animations can finish untouched. Flip to `true` once the heading settles.
   */
  active?: boolean;
  /** The starting variation settings (resting weight). */
  fromFontVariationSettings?: string;
  /** The variation settings reached under the cursor. */
  toFontVariationSettings?: string;
  /** Proximity radius that influences the effect, in pixels. */
  radius?: number;
  /** Type of falloff applied as the cursor moves away from a letter. */
  falloff?: VariableProximityFalloff;
}

/** Tracks the pointer position in viewport coordinates. */
function usePointerPositionRef() {
  const positionRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const set = (x: number, y: number) => {
      positionRef.current = { x, y };
    };

    const handleMouseMove = (event: MouseEvent) => set(event.clientX, event.clientY);
    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch) set(touch.clientX, touch.clientY);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("touchmove", handleTouchMove);
    };
  }, []);

  return positionRef;
}

/**
 * Shared engine behind every "Variable Proximity" surface on the site.
 *
 * Each letter's variable-font axes are interpolated from
 * `fromFontVariationSettings` to `toFontVariationSettings` based on the
 * cursor's distance, so text thickens as the pointer passes over it. The loop
 * only starts once `active` is `true`, which is how headings let their entrance
 * and scroll animations finish before the effect takes over.
 *
 * Returns the ref array the caller attaches to each letter. Tuned to run on
 * many headings at once: the per-letter pass is skipped while the container is
 * off-screen, pointer-far containers short-circuit, and letter rects are read in
 * one batch before any style is written (no layout thrash).
 */
export function useVariableProximity({
  containerRef,
  active = true,
  fromFontVariationSettings = "'wght' 400, 'opsz' 9",
  toFontVariationSettings = "'wght' 800, 'opsz' 40",
  radius = 50,
  falloff = "linear",
}: UseVariableProximityOptions): RefObject<(HTMLElement | null)[]> {
  const letterRefs = useRef<(HTMLElement | null)[]>([]);
  const pointerRef = usePointerPositionRef();
  const inViewRef = useRef(true);
  const wasActiveRef = useRef(false);
  const lastFrameRef = useRef<{
    x: number | null;
    y: number | null;
    left: number | null;
    top: number | null;
  }>({ x: null, y: null, left: null, top: null });

  // Only run the effect for containers currently near the viewport.
  useEffect(() => {
    const el = containerRef?.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      inViewRef.current = true;
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        inViewRef.current = entries[0]?.isIntersecting ?? true;
      },
      { rootMargin: "140px 0px 140px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef]);

  const parsedSettings = useMemo(() => {
    const parseSettings = (settingsStr: string) =>
      new Map(
        settingsStr
          .split(",")
          .map((s) => s.trim())
          .map((s) => {
            const [name, value] = s.split(" ");
            return [name.replace(/['"]/g, ""), parseFloat(value)];
          }),
      );

    const fromSettings = parseSettings(fromFontVariationSettings);
    const toSettings = parseSettings(toFontVariationSettings);

    return Array.from(fromSettings.entries()).map(([axis, fromValue]) => ({
      axis,
      fromValue,
      toValue: toSettings.get(axis) ?? fromValue,
    }));
  }, [fromFontVariationSettings, toFontVariationSettings]);

  useEffect(() => {
    const settleAll = (settings: string) => {
      for (const letter of letterRefs.current) {
        if (letter) letter.style.fontVariationSettings = settings;
      }
    };

    // Not settled yet: park every letter at its resting weight and stay idle.
    if (!active) {
      settleAll(fromFontVariationSettings);
      wasActiveRef.current = false;
      lastFrameRef.current = { x: null, y: null, left: null, top: null };
      return;
    }

    let frameId = 0;

    const run = () => {
      frameId = requestAnimationFrame(run);

      if (!inViewRef.current) return;

      const container = containerRef?.current;
      if (!container) return;

      const { x: clientX, y: clientY } = pointerRef.current;
      const containerRect = container.getBoundingClientRect();

      // Re-run when the pointer moves *or* the container scrolls under it.
      const last = lastFrameRef.current;
      if (
        last.x === clientX &&
        last.y === clientY &&
        last.left === containerRect.left &&
        last.top === containerRect.top
      ) {
        return;
      }
      lastFrameRef.current = {
        x: clientX,
        y: clientY,
        left: containerRect.left,
        top: containerRect.top,
      };

      const x = clientX - containerRect.left;
      const y = clientY - containerRect.top;

      // Pointer far from this heading: settle every letter once, then idle.
      const inside =
        x >= -radius &&
        y >= -radius &&
        x <= containerRect.width + radius &&
        y <= containerRect.height + radius;
      if (!inside) {
        if (wasActiveRef.current) {
          settleAll(fromFontVariationSettings);
          wasActiveRef.current = false;
        }
        return;
      }
      wasActiveRef.current = true;

      // Read every rect first, then write every style — avoids layout thrash.
      const letters = letterRefs.current;
      const rects: (DOMRect | null)[] = new Array(letters.length);
      for (let i = 0; i < letters.length; i += 1) {
        const letter = letters[i];
        rects[i] = letter ? letter.getBoundingClientRect() : null;
      }

      for (let i = 0; i < letters.length; i += 1) {
        const letter = letters[i];
        const rect = rects[i];
        if (!letter || !rect) continue;

        const letterCenterX = rect.left + rect.width / 2 - containerRect.left;
        const letterCenterY = rect.top + rect.height / 2 - containerRect.top;
        const distance = Math.hypot(x - letterCenterX, y - letterCenterY);

        if (distance >= radius) {
          letter.style.fontVariationSettings = fromFontVariationSettings;
          continue;
        }

        const norm = Math.min(Math.max(1 - distance / radius, 0), 1);
        let falloffValue: number;
        switch (falloff) {
          case "exponential":
            falloffValue = norm ** 2;
            break;
          case "gaussian":
            falloffValue = Math.exp(-((distance / (radius / 2)) ** 2) / 2);
            break;
          case "linear":
          default:
            falloffValue = norm;
        }

        let nextSettings = "";
        for (let j = 0; j < parsedSettings.length; j += 1) {
          const { axis, fromValue, toValue } = parsedSettings[j];
          const interpolatedValue = fromValue + (toValue - fromValue) * falloffValue;
          nextSettings += `${j === 0 ? "" : ", "}'${axis}' ${interpolatedValue}`;
        }
        letter.style.fontVariationSettings = nextSettings;
      }
    };

    frameId = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frameId);
  }, [
    active,
    containerRef,
    pointerRef,
    fromFontVariationSettings,
    radius,
    falloff,
    parsedSettings,
  ]);

  return letterRefs;
}
