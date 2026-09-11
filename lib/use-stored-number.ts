"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Number state persisted in localStorage, readable during SSR-safe hydration:
 * the server render and the first client paint get the fallback, then
 * `useSyncExternalStore` swaps in the stored value without a hydration
 * mismatch. Mirrors `useStoredBoolean`, including the same-tab listener set and
 * cross-tab `storage` event.
 */
const listeners = new Set<() => void>();

function readStoredNumber(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function useStoredNumber(
  key: string,
  fallback: number,
): [number, (next: number | ((current: number) => number)) => void] {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      listeners.add(onStoreChange);
      const onStorage = (event: StorageEvent) => {
        if (event.key === key) onStoreChange();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(onStoreChange);
        window.removeEventListener("storage", onStorage);
      };
    },
    [key],
  );

  const value = useSyncExternalStore(
    subscribe,
    () => readStoredNumber(key, fallback),
    () => fallback,
  );

  const setValue = useCallback(
    (next: number | ((current: number) => number)) => {
      const resolved =
        typeof next === "function"
          ? next(readStoredNumber(key, fallback))
          : next;
      try {
        window.localStorage.setItem(key, String(resolved));
      } catch {
        // Storage unavailable (private mode) — nothing to persist.
      }
      listeners.forEach((listener) => listener());
    },
    [key, fallback],
  );

  return [value, setValue];
}
