"use client";

import { useEffect, useLayoutEffect } from "react";

import {
  applyTheme,
  getStoredTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

/** useLayoutEffect on the client, useEffect during SSR (silences the warning). */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Theme backstop, mounted once in the root layout.
 *
 * The `beforeInteractive` boot script (app/layout.tsx) applies the theme
 * before first paint, so in production this component's re-apply is a no-op.
 * It exists for two edges:
 *
 * - In development, React's Strict Mode remount resets `<html>` attributes
 *   the boot script set; the layout effect restores them before paint.
 * - Cross-tab sync: when another tab stores a new theme choice, the `storage`
 *   event fires here and every open tab follows.
 */
export function ThemeSync() {
  useIsomorphicLayoutEffect(() => {
    applyTheme(resolveTheme(), { persist: false });

    // Cross-tab sync: another tab stored a new choice → follow it.
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) {
        applyTheme(resolveTheme(), { persist: false });
      }
    };
    window.addEventListener("storage", onStorage);

    // With no stored choice the theme tracks the OS — including live flips.
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onOsChange = () => {
      if (!getStoredTheme()) applyTheme(resolveTheme(), { persist: false });
    };
    mql.addEventListener("change", onOsChange);

    return () => {
      window.removeEventListener("storage", onStorage);
      mql.removeEventListener("change", onOsChange);
    };
  }, []);

  return null;
}
