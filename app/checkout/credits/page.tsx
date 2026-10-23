import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CreditPacksClient } from "@/components/billing/credit-packs-client";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Buy AI credits — Tartly",
  description: "Top up your Tartly AI credits.",
  robots: { index: false, follow: false },
};

/**
 * Credit top-up checkout. Signed-in users pick a pack and are handed to
 * Dodo's hosted one-time checkout; signed-out visitors sign in first.
 */
export default async function CreditsCheckoutPage() {
  const session = await getSession();
  if (!session?.user) {
    redirect(`/auth?next=${encodeURIComponent("/checkout/credits")}`);
  }

  return <CreditPacksClient />;
}
