import type { Metadata } from "next";
import { Geist, Inter, Roboto_Flex } from "next/font/google";
import Script from "next/script";
import type { ReactNode } from "react";
import { SafePointerCapture } from "@/components/shared/safe-pointer-capture";
import { ThemeSync } from "@/components/shared/theme/theme-sync";
import { TARTLY_LOGO_URL } from "@/components/shared/brand/brand-assets";
import { BillingProvider } from "@/components/app/paywall/billing-provider";
import { ImageKitRootProvider } from "@/components/shared/media";
import { MotionProvider } from "@/components/shared/motion/motion-provider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  // Exposed as a variable so the RedApe landing can map `font-mono-ui` to it.
  variable: "--font-inter",
});

/**
 * Variable font behind the hero "Variable Proximity" heading. The effect
 * interpolates both the `wght` and `opsz` axes, so `opsz` is opted in
 * explicitly — next/font only includes weight by default.
 */
const robotoFlex = Roboto_Flex({
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz"],
  variable: "--font-roboto-flex",
});

/**
 * Geist is the landing page's supporting-text face. Every non-heading element
 * on the public marketing page — eyebrows, body copy, nav and footer text —
 * reads in Geist, while headings stay on Inter / the proximity effect.
 * Exposed as a variable so the landing can map `font-subtext` to it.
 */
const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});

/**
 * Canonical production origin. Used for `metadataBase`, canonicals and the
 * structured-data block. Set NEXT_PUBLIC_BETTER_AUTH_URL in Vercel when the
 * verified domain changes so every absolute URL follows automatically.
 */
const siteUrl = (
  process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? "https://tartly.in"
).replace(/\/$/, "");

/**
 * Public Search Console verification token for `tartly.in`.
 *
 * The domain-property TXT record is the primary proof of ownership. Emitting
 * the same token as a `<meta name="google-site-verification">` tag is a
 * belt-and-braces fallback for verification reviews and for deployments where
 * `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` has not been set yet.
 */
const GOOGLE_SITE_VERIFICATION_FALLBACK =
  "8-4xg5w8YO4kwdArb86nzPoIJhwzgLiQraAkhhzW4Qg";

const appDescription =
  "Tartly is an AI email operator that connects to Gmail and Google Calendar (only with the permissions you approve) to triage your inbox, draft replies, schedule meetings, and handle follow-ups.";

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
  // Browser-tab and home-screen icons come from the `app/favicon.ico`,
  // `app/icon.png` and `app/apple-icon.png` file conventions — rounded Tartly
  // tiles (≈22% corner radius). Declaring `icons` here would take precedence
  // and suppress those files, so it is intentionally omitted.
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
    // Google Search Console ownership token. The env var wins so a rotated
    // token only needs a redeploy; the constant keeps the tag present even if
    // the variable is missing from an environment.
    google:
      process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ??
      GOOGLE_SITE_VERIFICATION_FALLBACK,
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
      logo: TARTLY_LOGO_URL,
      email: "support@tartly.in",
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

/**
 * Pre-hydration theme bootstrap. Runs before first paint: applies the user's
 * stored choice, else the OS preference, else the brand-default dark — by
 * toggling the `dark` class the light palette in `:root` / dark in `.dark`
 * (globals.css) keys off. Mirrors lib/theme.ts; keep the storage key in sync.
 *
 * Rendered through `next/script` `beforeInteractive` so the per-request CSP
 * nonce minted in proxy.ts is stamped automatically (a raw inline `<script>`
 * would be blocked by the app's strict CSP on authed routes).
 */
const themeInitScript = `(function(){try{var t=window.localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.classList.toggle("dark",t==="dark");}catch(e){}})();`;

export default function RootLayout({
  children,
  modal,
}: LayoutProps<"/"> & { modal?: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`dark h-full ${inter.className} ${inter.variable} ${robotoFlex.variable} ${geist.variable}`}
    >
      <body className="min-h-full" suppressHydrationWarning>
        {/* Injected into <head> and executed during parsing, before paint. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
        {/* Re-applies the theme after React's dev Strict-Mode remount (which
            resets `<html>` attributes the boot script set) and keeps tabs in
            sync via the storage event. A no-op in production. */}
        <ThemeSync />
        <SafePointerCapture />
        {/* Entrance animations write opacity/transform inline; without script
            they would never settle. Reveal everything for no-JS visitors. */}
        <noscript>
          <style>{`[data-reveal]{opacity:1 !important;transform:none !important;filter:none !important}`}</style>
        </noscript>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {/* ImageKit context for <MediaImage> / <MediaVideo> in the tree. A no-op
            while NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT is blank. */}
        <ImageKitRootProvider>
          <MotionProvider>
            <BillingProvider>
              {children}
              {/* Intercepted routes (@modal). Renders null unless a soft navigation
                  matches a settings route, in which case the section opens as a
                  glass popup over the current screen. */}
              {modal}
            </BillingProvider>
          </MotionProvider>
        </ImageKitRootProvider>
      </body>
    </html>
  );
}
