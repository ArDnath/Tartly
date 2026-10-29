import type { MetadataRoute } from "next";

/**
 * Only the public marketing + legal pages are crawlable. Everything behind
 * the session guard (mail, inbox, settings, …) is disallowed so Googlebot
 * never records the app shell as the app's public homepage.
 */
export default function robots(): MetadataRoute.Robots {
  const base =
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? "https://tartly.in";

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/pricing", "/privacy", "/terms"],
      disallow: [
        "/api/",
        "/auth",
        "/onboarding",
        "/mail",
        "/inbox",
        "/calendar",
        "/assistant",
        "/followups",
        "/activity",
        "/settings",
        "/runs",
        "/dev-profile",
      ],
    },
    sitemap: `${base.replace(/\/$/, "")}/sitemap.xml`,
    host: base.replace(/\/$/, ""),
  };
}
