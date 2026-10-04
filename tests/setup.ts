/**
 * Shared Vitest setup.
 *
 * `lib/env.ts` validates `process.env` at import time. Unit tests import
 * modules that (transitively) pull it in, so the suite must provide a minimal,
 * non-secret environment. Values already present (CI, a developer's shell) win.
 */
const placeholders: Record<string, string> = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app_test",
  BETTER_AUTH_SECRET: "vitest-secret-vitest-secret",
  BETTER_AUTH_URL: "http://localhost:3000",
  NEXT_PUBLIC_BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "vitest-google-client-id",
  GOOGLE_CLIENT_SECRET: "vitest-google-client-secret",
  UPSTASH_REDIS_REST_URL: "https://upstash.invalid",
  UPSTASH_REDIS_REST_TOKEN: "vitest-upstash-token",
  // A throwaway 32-byte AES-256-GCM key so extraction crypto is testable.
  ASSET_EXTRACT_KEY: "09ilu9oqhYDabo/FyuyvS4YTe6sW/xSNp2HAXosh/0M=",
};

for (const [key, value] of Object.entries(placeholders)) {
  if (!process.env[key]) process.env[key] = value;
}

// Keep the logger at `debug` so its emission/redaction paths are exercised and
// `minLevel()`'s configured branch is covered. Tests that need silence mock the
// underlying `process.stdout/stderr.write`.
process.env.LOG_LEVEL ??= "debug";

export {};
