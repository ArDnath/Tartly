"use client";

import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { PaywallOverlay } from "@/components/app/paywall/paywall-overlay";
import { usePaywallStore } from "@/components/app/paywall/paywall-store";

/**
 * Mounts the paywall for the whole app. It pulls the entitlement snapshot on
 * mount, on every route change (so returning from checkout unlocks instantly)
 * and when the tab regains focus (so a subscription completed in another step
 * takes effect without a reload).
 */
export function BillingProvider({ children }: { children: ReactNode }) {
  const refresh = usePaywallStore((state) => state.refresh);
  const pathname = usePathname();

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    const onFocus = () => void usePaywallStore.getState().refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  return (
    <>
      {children}
      <PaywallOverlay />
    </>
  );
}
