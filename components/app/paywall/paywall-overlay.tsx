"use client";

import { AnimatePresence, motion } from "motion/react";
import { usePathname } from "next/navigation";

import { PaywallCard } from "@/components/app/paywall/paywall-card";
import { usePaywallStore } from "@/components/app/paywall/paywall-store";

/**
 * Routes where the wall must never cover the screen: the public marketing pages
 * and the checkout/onboarding flows themselves. Blocking them would make the
 * wall unsubscribable.
 */
function isSuppressedRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/checkout") ||
    pathname.startsWith("/pricing") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/onboarding")
  );
}

/**
 * Renders the paywall the moment a free user attempts a gated action this
 * session — the AI/agent, connecting a second account, or reading/sending
 * beyond the free allowance.
 *
 * It deliberately does NOT open on page load. A persisted server lock
 * (`paywallLocked`) is still recorded for enforcement and analytics, but the
 * user is allowed to land on `/mail` and see their inbox without being
 * interrupted; the wall appears only once they actually try something gated.
 * This changes *when* the card is shown, not what is allowed — every gated
 * endpoint still returns `402 payment_required` on its own.
 *
 * The scrim is a light glass veil rather than an opaque curtain — the gated
 * screen stays visible behind it for context while the full-bleed layer still
 * captures every click, so nothing underneath is usable.
 */
export function PaywallOverlay() {
  const pathname = usePathname();
  const entitlement = usePaywallStore((state) => state.entitlement);
  const opened = usePaywallStore((state) => state.opened);
  const dismissed = usePaywallStore((state) => state.dismissed);
  const reason = usePaywallStore((state) => state.reason);

  const isSubscriber = entitlement?.isSubscriber ?? false;
  const suppressed = isSuppressedRoute(pathname);
  const show = !suppressed && !isSubscriber && !dismissed && opened;

  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="paywall"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-black/20 p-4 backdrop-blur-[3px] backdrop-saturate-150"
        >
          <PaywallCard
            reason={reason ?? entitlement?.paywallReason ?? "ai"}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
