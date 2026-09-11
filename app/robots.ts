import type { MetadataRoute } from "next";

/**
 * Only the public marketing + legal pages are crawlable. Everything behind
 * the session guard (mail, inbox, settings, …) is disallowed so Googlebot
 * never records the app shell as the app's public homepage.
 */
export default function robots(): MetadataRoute.Robots {
  const base =
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? "https://apeemail-one.vercel.app";

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacy", "/terms"],
      disallow: [
        "/api/",
        "/auth",
        "/onboarding",
        "/mail",
        "/inbox",
        "/calendar",
        "/assistant",
        "/followups",
        "/metrics",
        "/settings",
        "/runs",
        "/dev-profile",
      ],
    },
    sitemap: `${base.replace(/\/$/, "")}/sitemap.xml`,
    host: base.replace(/\/$/, ""),
  };
}
