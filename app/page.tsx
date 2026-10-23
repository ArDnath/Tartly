import type { Metadata } from "next";

import HomeContent from "@/components/marketing/landing/home-content";
import { Navbar } from "@/components/marketing/navbar";

/**
 * Public landing page.
 *
 * Visual system ported from the ZeroMail landing page, rebuilt with Tartly's
 * "AI email operator" positioning and copy (see the marketing playbook) and
 * wired to Tartly's own navigation and auth entry points.
 */
export const metadata: Metadata = {
  title: "Tartly — Your 24/7 AI email operator",
  description:
    "Tartly reads, summarizes, composes, replies, follows up, and moves sales conversations forward — so your inbox keeps working even when you are offline.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Tartly — Your 24/7 AI email operator",
    description:
      "Stop managing email. Put it to work. Tartly is the 24/7 AI email operator that handles your inbox, replies to customers, and chases every follow-up.",
    url: "/",
    type: "website",
  },
};

export default function Page() {
  return (
    <div className="font-subtext relative isolate min-h-screen overflow-x-clip bg-[#0F0F0F]">
      <Navbar active="Features" />
      <HomeContent />
    </div>
  );
}
