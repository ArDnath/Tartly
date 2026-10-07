"use client";

import { usePathname } from "next/navigation";
import * as React from "react";

/**
 * Height of the fixed marketing nav (plus a little air), in px. In-page jumps
 * subtract this so a section heading never lands underneath the nav.
 */
const SCROLL_OFFSET = 96;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Smoothly scrolls to an in-page section, offsetting by the fixed nav. Returns
 * `false` when the href is not an in-page hash or the target is missing, so
 * callers can fall through to routing. The address bar is kept shareable via
 * `replaceState` rather than a second scroll.
 */
export function scrollToHash(href: string): boolean {
  const isBareHash = href.startsWith("#");
  const isHomeHash = href.startsWith("/#");
  if (!isBareHash && !isHomeHash) return false;

  const hash = isBareHash ? href : href.slice(1);
  const id = hash.replace(/^#/, "");
  const target = id ? document.getElementById(id) : null;
  if (!target) return false;

  const top =
    target.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET;

  window.scrollTo({
    top,
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });

  window.history.replaceState(null, "", hash);
  return true;
}

/**
 * Smoothly scrolls the window back to the top of the page. Used when the brand
 * lockup is activated while already on the home route, where re-navigating to
 * `/` would otherwise do nothing.
 */
export function scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
}

/**
 * Smoothly scrolls to an in-page section when a nav link is clicked.
 *
 * Only same-page hash targets are intercepted — `#features` on any page, or
 * `/#features` while already on `/`. Every other link falls through to normal
 * Next.js navigation, so a `/#features` click from another route still lands on
 * the landing section. The handler is safe to call on route links; it simply
 * returns without preventing default.
 */
export function useSmoothScroll() {
  const pathname = usePathname();

  return React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      const isBareHash = href.startsWith("#");
      const isHomeHash = href.startsWith("/#");

      if (!isBareHash && !isHomeHash) return;
      // `/#section` from another route should navigate, not scroll here.
      if (isHomeHash && pathname !== "/") return;

      if (scrollToHash(href)) event.preventDefault();
    },
    [pathname],
  );
}
