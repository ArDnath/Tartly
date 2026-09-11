import { z } from "zod";

/**
 * Centralized, type-safe environment validation with Zod.
 * Import this module first in server entry points so misconfiguration
 * fails fast with a readable error instead of a cryptic runtime crash.
 */

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (postgres connection string)"),

  BETTER_AUTH_SECRET: z
    .string()
    .min(16, "BETTER_AUTH_SECRET must be at least 16 characters")
    .describe("Generate with: openssl rand -base64 32"),

  // Public base URL used for OAuth callbacks, e.g. http://localhost:3000
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),

  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),

  // Upstash Redis (HTTP REST) — session secondary storage.
  UPSTASH_REDIS_REST_URL: z
    .string()
    .url("UPSTASH_REDIS_REST_URL must be a valid URL"),
  UPSTASH_REDIS_REST_TOKEN: z
    .string()
    .min(1, "UPSTASH_REDIS_REST_TOKEN is required"),

  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  /* --- Email operator (optional until the feature is enabled) --- */

  // Vercel cron auth. Required once the cron routes are deployed.
  CRON_SECRET: z.string().min(1).optional(),

  // Google Pub/Sub topic the mailbox watch publishes to, e.g.
  // `projects/<project>/topics/gmail-inbox`.
  GOOGLE_PUBSUB_TOPIC: z.string().min(1).optional(),
  // The push endpoint URL, used as the OIDC audience. Defaults to
  // `${BETTER_AUTH_URL}/api/webhooks/gmail` when unset.
  GOOGLE_PUBSUB_AUDIENCE: z.string().url().optional(),

  // Optional booking-link fallback when no meeting slot is agreed.
  NEXT_PUBLIC_BOOKING_URL: z.string().url().optional(),
  // Cal.com slug embedded on the "book a call" step (the part after
  // `cal.com/`), e.g. `ariyaman/30min`. Not a full URL.
  NEXT_PUBLIC_CAL_BOOKING_LINK: z.string().min(1).optional(),
  // Google Search Console verification token surfaced in `app/layout.tsx`.
  NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: z.string().min(1).optional(),

  // Cheap model for triage/classification; drafting model. Fall back to
  // AI_MODEL_ID when unset.
  AI_MODEL_CLASSIFIER_ID: z.string().min(1).optional(),
  AI_MODEL_DRAFT_ID: z.string().min(1).optional(),

  /* --- Web research (Phase 9; optional until a provider is configured) --- */

  // Adapter id: "tavily" (default) | future: "brave" | "serpapi".
  SEARCH_PROVIDER: z.string().min(1).optional(),
  // Provider API key. Server-only — never expose this to a client component.
  SEARCH_API_KEY: z.string().min(1).optional(),
  // How long a research result may be served from the Postgres cache.
  RESEARCH_CACHE_TTL_MS: z.coerce.number().int().positive().optional(),

  /* --- AI provider (optional; the assistant degrades to offline copy) --- */

  // Adapter id, e.g. "opencode". Reserved for future multi-provider routing.
  AI_PROVIDER: z.string().min(1).optional(),
  // Gateway key. Server-only — never expose this to a client component.
  OPENCODE_API_KEY: z.string().min(1).optional(),
  AI_BASE_URL: z.string().url().optional(),
  AI_MODEL_ID: z.string().min(1).optional(),
  // Stronger model for multi-step research/reasoning; falls back to AI_MODEL_ID.
  AI_MODEL_REASONING_ID: z.string().min(1).optional(),
  // Go-subscription models require a stable per-conversation session header.
  OPENCODE_SESSION_ID: z.string().min(1).optional(),
  // "false" for models that reject response_format JSON schemas.
  AI_STRUCTURED_OUTPUTS: z.enum(["true", "false"]).optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  // Treat an empty string as "unset". `.env` files commonly carry optional keys
  // as `FOO=""`, and Zod's `.optional()` only accepts `undefined` — without
  // this, a copied `.env.example` fails at import time before any route runs.
  //
  // `[SENSITIVE]` is the placeholder `vercel build` writes when it cannot read
  // a secret-typed variable back (e.g. a local/`--prebuilt` build). Treating it
  // as unset lets those builds fall back to defaults instead of failing page
  // data collection; the real value is present on Vercel at runtime.
  const raw = Object.fromEntries(
    Object.entries(process.env).filter(
      ([, value]) => value !== "" && value !== "[SENSITIVE]",
    ),
  );
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(
      "Invalid environment variables:",
      JSON.stringify(parsed.error.flatten().fieldErrors, null, 2),
    );
    throw new Error("Invalid environment variables. Check .env (see .env.example).");
  }
  return parsed.data;
}

export const env = validateEnv();

/**
 * The email operator is "enabled" once a Pub/Sub topic is configured. Until
 * then the webhook/cron routes refuse to run rather than half-working.
 */
export function isEmailOperatorEnabled(): boolean {
  return Boolean(env.GOOGLE_PUBSUB_TOPIC);
}

/** OIDC audience for the Pub/Sub push, defaulting to the webhook URL. */
export function getPubSubAudience(): string {
  return (
    env.GOOGLE_PUBSUB_AUDIENCE ??
    `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/api/webhooks/gmail`
  );
}
