import { env } from "@/lib/env";

/**
 * Canonical public origin for absolute URLs (redirects, OAuth returns,
 * checkout/payment return URLs).
 *
 * Never build these from `request.nextUrl.origin` or the `Host` header. The
 * Next.js standalone server binds to `0.0.0.0:3000` and sits behind Caddy, so
 * the framework-visible request URL can be `https://0.0.0.0:3000`. That leaked
 * into the onboarding Gmail-connect redirect (users were sent to
 * `https://0.0.0.0:3000/onboarding`) and would have leaked into billing return
 * URLs.
 *
 * `BETTER_AUTH_URL` is the single canonical origin for this deployment
 * (`https://tartly.in`), is validated as a URL by `lib/env.ts`, and is already
 * the base URL Better Auth uses for OAuth callbacks.
 */
export function publicOrigin(): string {
  return env.BETTER_AUTH_URL.replace(/\/+$/, "");
}

/** Build an absolute URL on the canonical public origin. */
export function publicUrl(path: string): URL {
  return new URL(path, `${publicOrigin()}/`);
}
