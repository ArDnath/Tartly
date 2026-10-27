import type { Metadata } from "next";

import HomeContent from "@/components/marketing/landing/home-content";
import { LandingSmoothScroll } from "@/components/marketing/landing/landing-smooth-scroll";
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
    // The landing follows the app-wide theme. Its canvas, ink, hairlines and
    // FAQ cards read the `--landing-*` tokens (globals.css), which resolve to
    // the light or dark palette per the `dark` class on `<html>`. Product
    // mock-ups, the trust panel, pricing cards and footer stay deliberately
    // dark in both themes, so they read as screenshots / instrument panels.
    <div className="font-subtext relative isolate min-h-screen overflow-x-clip bg-[var(--landing-bg)] text-[var(--landing-fg)]">
      {/* Warm up the embed origins while the hero copy paints, so the demo
          iframe's handshake (iframe_api + player + poster) starts earlier.
          React hoists these <link>s into <head>. */}
      <link rel="preconnect" href="https://www.youtube.com" />
      <link rel="preconnect" href="https://i.ytimg.com" />
      <link rel="dns-prefetch" href="https://www.google.com" />
      <LandingSmoothScroll />
      <Navbar active="Features" themeToggle />
      <HomeContent />
    </div>
  );
}
