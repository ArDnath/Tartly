import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import { SafePointerCapture } from "@/components/safe-pointer-capture";
import { ImageKitRootProvider } from "@/components/media";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  // Exposed as a variable so the RedApe landing can map `font-mono-ui` to it.
  variable: "--font-inter",
});

/**
 * Brand-only display face. Inter stays the single UI voice; Space Grotesk is
 * scoped to the Tartly wordmark (see `components/brand/tartly-wordmark.tsx`) so
 * the name reads as a logo rather than another piece of chrome.
 */
const display = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

/**
 * Canonical production origin. Used for `metadataBase`, canonicals and the
 * structured-data block. Set NEXT_PUBLIC_BETTER_AUTH_URL in Vercel when the
 * verified domain changes so every absolute URL follows automatically.
 */
const siteUrl = (
  process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? "https://apeemail-one.vercel.app"
).replace(/\/$/, "");

const appDescription =
  "Tartly is an AI email operator that connects to your Gmail and Google Calendar (only with the permissions you approve) to triage your inbox, draft replies, schedule meetings, and handle follow-ups.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "Tartly",
  title: {
    default: "Tartly — Your AI email operator",
    template: "%s",
  },
  description: appDescription,
  keywords: [
    "Tartly",
    "AI email operator",
    "email triage",
    "AI email assistant",
    "Gmail",
    "Google Calendar",
    "inbox management",
  ],
  authors: [{ name: "Tartly", url: siteUrl }],
  creator: "Tartly",
  publisher: "Tartly",
  category: "productivity",
  alternates: { canonical: "/" },
  openGraph: {
    siteName: "Tartly",
    title: "Tartly — Your AI email operator",
    description:
      "Triage your inbox, draft replies, schedule meetings, and handle follow-ups with an AI email operator that works in your inbox.",
    url: "/",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Tartly — Your AI email operator",
    description:
      "Triage your inbox, draft replies, schedule meetings, and handle follow-ups with an AI email operator.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  verification: {
    // Google Search Console ownership token. Set
    // NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION in Vercel to the `content` value
    // shown in the "HTML tag" verification method, then verify in Search Console.
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
  },
};

/**
 * Organization + WebSite + SoftwareApplication structured data. Lets Google
 * associate the "Tartly" name, logo and homepage with the OAuth consent
 * screen branding for this app.
 */
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: "Tartly",
      url: siteUrl,
      logo: `${siteUrl}/logo.png`,
      email: "support@tartly.app",
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      name: "Tartly",
      url: siteUrl,
      publisher: { "@id": `${siteUrl}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${siteUrl}/#app`,
      name: "Tartly",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: siteUrl,
      description: appDescription,
      publisher: { "@id": `${siteUrl}/#organization` },
      privacyPolicy: `${siteUrl}/privacy`,
      termsOfService: `${siteUrl}/terms`,
    },
  ],
};

export default function RootLayout({
  children,
  modal,
}: LayoutProps<"/"> & { modal?: ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark h-full ${inter.className} ${inter.variable} ${display.variable}`}
    >
      <body className="min-h-full" suppressHydrationWarning>
        <SafePointerCapture />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {/* ImageKit context for <MediaImage> / <MediaVideo> in the tree. A no-op
            while NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT is blank. */}
        <ImageKitRootProvider>
          {children}
          {/* Intercepted routes (@modal). Renders null unless a soft navigation
              matches a settings route, in which case the section opens as a
              glass popup over the current screen. */}
          {modal}
        </ImageKitRootProvider>
      </body>
    </html>
  );
}
