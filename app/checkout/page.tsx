import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CheckoutClient } from "@/components/billing/checkout-client";
import { isBillingInterval } from "@/lib/billing/plans";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Checkout — Tartly",
  description: "Subscribe to Tartly Professional.",
  robots: { index: false, follow: false },
};

/**
 * In-app checkout route.
 *
 * Signed-in users see the Dodo-hosted checkout after tapping subscribe (no
 * card data ever touches this page). Signed-out visitors are sent through Google
 * sign-in first and returned here — the "sign up, then pay" order the product
 * requires.
 */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ interval?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawInterval = Array.isArray(params.interval)
    ? params.interval[0]
    : params.interval;
  const interval = isBillingInterval(rawInterval) ? rawInterval : "year";

  const session = await getSession();
  if (!session?.user) {
    redirect(
      `/auth?next=${encodeURIComponent(`/checkout?interval=${interval}`)}`,
    );
  }

  return <CheckoutClient interval={interval} />;
}
