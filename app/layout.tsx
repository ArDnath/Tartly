import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SafePointerCapture } from "@/components/safe-pointer-capture";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
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
  "Lunabox is an AI email operator that connects to your Gmail and Google Calendar (only with the permissions you approve) to triage your inbox, draft replies, schedule meetings, and handle follow-ups.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "Lunabox",
  title: {
    default: "Lunabox — Your AI email operator",
    template: "%s",
  },
  description: appDescription,
  keywords: [
    "Lunabox",
    "AI email operator",
    "email triage",
    "AI email assistant",
    "Gmail",
    "Google Calendar",
    "inbox management",
  ],
  authors: [{ name: "Lunabox", url: siteUrl }],
  creator: "Lunabox",
  publisher: "Lunabox",
  category: "productivity",
  alternates: { canonical: "/" },
  openGraph: {
    siteName: "Lunabox",
    title: "Lunabox — Your AI email operator",
    description:
      "Triage your inbox, draft replies, schedule meetings, and handle follow-ups with an AI email operator that works in your inbox.",
    url: "/",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Lunabox — Your AI email operator",
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
 * associate the "Lunabox" name, logo and homepage with the OAuth consent
 * screen branding for this app.
 */
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: "Lunabox",
      url: siteUrl,
      logo: `${siteUrl}/logo.png`,
      email: "support@lunabox.app",
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      name: "Lunabox",
      url: siteUrl,
      publisher: { "@id": `${siteUrl}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${siteUrl}/#app`,
      name: "Lunabox",
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark h-full ${inter.className}`}>
      <body className="min-h-full" suppressHydrationWarning>
        <SafePointerCapture />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {children}
      </body>
    </html>
  );
}
