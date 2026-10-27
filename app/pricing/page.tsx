import type { Metadata } from "next";

import Footer from "@/components/marketing/landing/footer";
import { PricingSection } from "@/components/marketing/landing/pricing-section";
import { Navbar } from "@/components/marketing/navbar";

/**
 * Standalone pricing page.
 *
 * Reuses the landing page's visual system — the fixed marketing nav, the shared
 * pricing table, and the closing footer — so the route reads as part of the
 * same site rather than a bolted-on page.
 */
export const metadata: Metadata = {
  title: "Pricing — Tartly",
  description:
    "Simple, transparent pricing for Tartly's 24/7 AI email operator. Start on Professional and save when you bill annually, or talk to us about an Enterprise plan.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing — Tartly",
    description:
      "Simple, transparent pricing for Tartly's 24/7 AI email operator. Start on Professional or talk to us about Enterprise.",
    url: "/pricing",
    type: "website",
  },
};

export default function PricingPage() {
  return (
    // Pinned dark: the `dark` wrapper forces the shared `--landing-*` tokens
    // to their dark values, so this route's pricing panel stays dark no
    // matter the app theme — unlike the landing, which follows the toggle.
    <div className="dark font-subtext relative isolate min-h-screen overflow-x-clip bg-[#0F0F0F]">
      <Navbar active="Pricing" />
      <main className="relative flex flex-1 flex-col overflow-x-hidden bg-[#0F0F0F] pt-32 md:pt-40">
        <PricingSection
          className="relative mx-auto w-full max-w-[1250px] px-6"
          variant="geometric"
        />

        <div className="relative mt-32 flex items-center justify-center md:mt-52">
          <Footer />
        </div>
      </main>
    </div>
  );
}
