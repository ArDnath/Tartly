import type { MetadataRoute } from "next";

/**
 * The homepage plus the two legal pages are the only URLs Google needs for
 * OAuth brand verification. They are fully public and log-in free.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? "https://apeemail-one.vercel.app"
  ).replace(/\/$/, "");

  const lastModified = new Date();

  return [
    { url: `${base}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    {
      url: `${base}/privacy`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${base}/terms`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];
}
