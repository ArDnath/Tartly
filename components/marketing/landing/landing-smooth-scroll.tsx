'use client';

import Lenis from 'lenis';
import { useEffect } from 'react';

declare global {
  interface Window {
    __lenis?: Lenis;
  }
}

/**
 * Buttery scroll smoothing for the marketing pages, powered by Lenis.
 *
 * Scoped to the landing page on purpose: the app shell scrolls inside its own
 * containers, which Lenis should never touch. Lenis animates the *native*
 * scroll position (no transform hijacking), so position:fixed chrome, GSAP
 * ScrollTrigger, IntersectionObservers and `scroll-padding-top` all keep
 * working untouched.
 *
 * The instance is exposed on `window.__lenis` so the anchor helpers in
 * `use-smooth-scroll.ts` can route hash jumps through the same eased motion
 * instead of fighting it with a native smooth `scrollTo`.
 *
 * Under `prefers-reduced-motion` Lenis is never started — the page keeps its
 * plain native scrolling and instant anchor jumps.
 */
export function LandingSmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const lenis = new Lenis({
      autoRaf: true,
      // Keep the ease-in feel, but catch up to the wheel input sooner so the
      // page stays responsive instead of feeling like it trails behind.
      lerp: 0.16,
      wheelMultiplier: 1,
    });
    window.__lenis = lenis;

    return () => {
      lenis.destroy();
      window.__lenis = undefined;
    };
  }, []);

  return null;
}
