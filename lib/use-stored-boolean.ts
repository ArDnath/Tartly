"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Boolean state persisted in localStorage, readable during SSR-safe
 * hydration: the server render and the first client paint get the fallback,
 * then `useSyncExternalStore` swaps in the stored value without a hydration
 * mismatch. Same-tab updates are broadcast through a local listener set;
 * cross-tab updates ride the `storage` event.
 */
const listeners = new Set<() => void>();

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

export function useStoredBoolean(
  key: string,
  fallback: boolean,
): [boolean, (next: boolean | ((current: boolean) => boolean)) => void] {
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
    () => readStoredBoolean(key, fallback),
    () => fallback,
  );

  const setValue = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      const resolved =
        typeof next === "function"
          ? next(readStoredBoolean(key, fallback))
          : next;
      try {
        window.localStorage.setItem(key, resolved ? "1" : "0");
      } catch {
        // Storage unavailable (private mode) — nothing to persist.
      }
      listeners.forEach((listener) => listener());
    },
    [key, fallback],
  );

  return [value, setValue];
}
