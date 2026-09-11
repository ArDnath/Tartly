"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Better Auth client for React / Next.js App Router.
 * Use `authClient.signIn.social({ provider: "google" })`,
 * `authClient.signOut()`, and `authClient.useSession()`.
 */
// Use the explicitly configured auth origin when one is supplied. Without a
// public URL, Better Auth resolves the browser origin and `/api/auth` path at
// runtime; never silently fall back to localhost on another deployment.
const authBaseURL = process.env.NEXT_PUBLIC_BETTER_AUTH_URL;

export const authClient = createAuthClient(
  authBaseURL ? { baseURL: authBaseURL } : undefined,
);

export const { signIn, signOut, useSession } = authClient;
