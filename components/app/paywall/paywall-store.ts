"use client";

import { create } from "zustand";

import type {
  BillingStatusResponse,
  Entitlement,
  PaywallReason,
} from "@/lib/billing/paywall-types";

/**
 * Global paywall state.
 *
 * Lives outside React so non-component code (the mail store, fetch handlers) can
 * trigger the wall imperatively via `openPaywall`. The entitlement itself is
 * always server-derived; the store only mirrors it for rendering, and the
 * server-side lock makes the wall durable across reloads.
 */

type PaywallState = {
  entitlement: Entitlement | null;
  plan: BillingStatusResponse["plan"] | null;
  /** A gated action was attempted this session. */
  opened: boolean;
  /** The reason the wall was last opened, for tailored copy. */
  reason: PaywallReason | null;
  /** Session-only dismissal; the server lock still brings it back next load. */
  dismissed: boolean;
  statusLoading: boolean;

  applyStatus: (payload: BillingStatusResponse) => void;
  applyEntitlement: (entitlement: Entitlement) => void;
  open: (reason?: PaywallReason) => void;
  close: () => void;
  refresh: () => Promise<void>;
};

export const usePaywallStore = create<PaywallState>((set) => ({
  entitlement: null,
  plan: null,
  opened: false,
  reason: null,
  dismissed: false,
  statusLoading: false,

  applyStatus: (payload) =>
    set({
      entitlement: payload.entitlement,
      plan: payload.plan,
      statusLoading: false,
    }),

  applyEntitlement: (entitlement) =>
    set((state) => ({
      entitlement,
      // A fresh subscription clears the lock and closes the wall.
      opened: entitlement.isSubscriber ? false : state.opened,
      dismissed: entitlement.isSubscriber ? false : state.dismissed,
    })),

  open: (reason) =>
    set({
      opened: true,
      reason: reason ?? null,
      dismissed: false,
    }),

  close: () => set({ opened: false, dismissed: true }),

  refresh: async () => {
    set({ statusLoading: true });
    try {
      const response = await fetch("/api/billing/status", {
        cache: "no-store",
      });
      if (response.status === 401) {
        set({ entitlement: null, statusLoading: false });
        return;
      }
      if (!response.ok) {
        set({ statusLoading: false });
        return;
      }
      const payload = (await response.json()) as {
        data: BillingStatusResponse;
      };
      set({
        entitlement: payload.data.entitlement,
        plan: payload.data.plan,
        statusLoading: false,
      });
    } catch {
      set({ statusLoading: false });
    }
  },
}));

/** Imperative trigger for non-React callers. Also persists the server lock. */
export function openPaywall(reason: PaywallReason = "ai"): void {
  usePaywallStore.getState().open(reason);
  // Persist the lock so the wall survives reloads even when the trigger was a
  // client-side interception that never reached a gated endpoint.
  void fetch("/api/billing/paywall", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  }).catch(() => undefined);
}

/** Whether the current user has an active subscription (best-effort client). */
export function hasActiveSubscription(): boolean {
  return usePaywallStore.getState().entitlement?.isSubscriber ?? false;
}
