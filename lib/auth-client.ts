"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Better Auth client for React / Next.js App Router.
 * Use `authClient.signIn.social({ provider: "google" })`,
 * `authClient.signOut()`, and `authClient.useSession()`.
 */
const configuredBaseURL = process.env.NEXT_PUBLIC_BETTER_AUTH_URL;

/**
 * The auth API is served by this same app (`app/api/auth/[...all]`), so the
 * browser must always call the origin that served the page.
 *
 * Pointing the client at a build-time absolute URL (e.g. production
 * `https://tartly.in`) breaks every non-production origin: `localhost` and
 * preview deployments would POST cross-origin to production, where the browser
 * blocks the response (`Access-Control-Allow-Origin` missing) and the OAuth
 * state cookie is written on the wrong host. The server still pins OAuth
 * `redirect_uri` to `BETTER_AUTH_URL`; only the browser request target follows
 * the page origin. On the server (SSR of a client component) fall back to the
 * configured URL.
 */
const baseURL =
  typeof window !== "undefined" ? window.location.origin : configuredBaseURL;

export const authClient = createAuthClient(
  baseURL ? { baseURL } : undefined,
);

export const { signIn, signOut, useSession } = authClient;
