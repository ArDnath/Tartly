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

  // Per-instance pg pool ceiling. Keep it small on serverless (default 5);
  // the provider-side pooler bounds total connections, not this.
  DB_POOL_MAX: z.coerce.number().int().positive().optional(),

  // Optional read-replica connection string (Phase D3). When unset, reads use
  // the primary. See docs/runbooks/scaling-and-connections.md.
  DATABASE_REPLICA_URL: z.string().min(1).optional(),

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

  /* --- Operational hardening (Phase A) --- */

  // Minimum level emitted by the structured logger. Defaults to `info` in
  // production and `debug` elsewhere.
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "fatal"]).optional(),
  // Per-user requests/minute applied to authenticated API routes by default.
  API_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().optional(),
  // Stricter per-user limits for expensive routes (agent runs, uploads).
  AGENT_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().optional(),
  ASSET_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().optional(),

  /* --- API contract enforcement (Phase C1) --- */

  // Runtime request validation against the generated OpenAPI contract:
  //   off     — never validate
  //   warn    — log `contract.violation` and continue
  //   enforce — reject with 400 before the handler runs (default)
  API_CONTRACT_VALIDATION: z.enum(["off", "warn", "enforce"]).optional(),

  /* --- Content Security Policy (Phase C6) --- */

  // Nonce-based CSP emitted by `proxy.ts`:
  //   off     — emit no CSP header
  //   report  — emit `Content-Security-Policy-Report-Only` (default, burn-in)
  //   enforce — emit the enforcing `Content-Security-Policy` header
  CSP_MODE: z.enum(["off", "report", "enforce"]).optional(),
  // Optional `report-uri` sink (relative path or absolute URL). Only meaningful
  // while CSP_MODE=report/enforce.
  CSP_REPORT_URI: z.string().min(1).optional(),

  /* --- Metrics (Phase D5) --- */

  // Bearer token for the Prometheus scrape endpoint
  // (`GET /api/health/metrics`). Unset keeps the endpoint hidden (404).
  METRICS_TOKEN: z.string().min(16).optional(),

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

  /* --- AI upgrade: model chains, fallback provider (all optional) --- */

  // Ordered fallback candidates per role, comma-separated `provider:model`.
  // Example: `opencode:space-bunny-free,fallback:gpt-4o-mini`. Unset falls back
  // to the single model configured for that role.
  AI_MODEL_FAST_CHAIN: z.string().min(1).optional(),
  AI_MODEL_STANDARD_CHAIN: z.string().min(1).optional(),
  AI_MODEL_REASONING_CHAIN: z.string().min(1).optional(),
  // A second OpenAI-compatible gateway used by `provider:fallback` entries.
  AI_PROVIDER_FALLBACK_ID: z.string().min(1).optional(),
  AI_PROVIDER_FALLBACK_BASE_URL: z.string().url().optional(),
  AI_PROVIDER_FALLBACK_API_KEY: z.string().min(1).optional(),

  /* --- AI upgrade: cost & reliability --- */

  // Platform-wide daily ceiling (in AI calls) across all users. Blank = no cap.
  AI_GLOBAL_DAILY_BUDGET: z.coerce.number().int().positive().optional(),
  // Compact the agent conversation once its estimated tokens exceed this.
  AGENT_CONTEXT_TOKEN_THRESHOLD: z.coerce.number().int().positive().optional(),
  // Hard ceiling on a single agent turn's prompt+completion tokens.
  AGENT_MAX_TOKENS_PER_RUN: z.coerce.number().int().positive().optional(),
  // Progressive agent tool disclosure: start with core tools only and let the
  // model unlock the rest via `activate_tools`. Opt-in (blank = off) because it
  // changes which tools the model sees.
  AGENT_PROGRESSIVE_TOOLS: z.enum(["true", "false"]).optional(),
  // Provider circuit breaker: open after N consecutive failures for M ms.
  AI_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().positive().optional(),
  AI_CIRCUIT_OPEN_MS: z.coerce.number().int().positive().optional(),

  /* --- Phase 1 feature gates (blank falls back to the shipped default) --- */

  // Voice/memory/knowledge ship enabled by default once a model is configured;
  // set to "false" to hard-disable. (Later, riskier phases default to off.)
  ASSISTANT_VOICE_ENABLED: z.enum(["true", "false"]).optional(),
  ASSISTANT_MEMORY_ENABLED: z.enum(["true", "false"]).optional(),
  ASSISTANT_KNOWLEDGE_ENABLED: z.enum(["true", "false"]).optional(),

  /* --- Phase 2 feature gates (blank falls back to the shipped default) --- */

  // Sender intelligence is cached (one call per new sender) and reversible, so
  // it ships on; set to "false" to hard-disable the whole subsystem.
  SENDER_INTELLIGENCE_ENABLED: z.enum(["true", "false"]).optional(),
  COLD_EMAIL_BLOCKER_ENABLED: z.enum(["true", "false"]).optional(),
  SENDER_CATEGORIZATION_ENABLED: z.enum(["true", "false"]).optional(),
  // Thread summaries cost a model call; only ever generated on user request.
  THREAD_SUMMARY_ENABLED: z.enum(["true", "false"]).optional(),

  /* --- Phase 3 feature gate (blank falls back to the shipped default) --- */

  // Plain-English rules: reversible config + deterministic-first evaluation.
  RULES_ENABLED: z.enum(["true", "false"]).optional(),

  /* --- Phase 4 feature gates (blank falls back to the shipped default) --- */

  // Smart compose: streaming, never auto-sends, hard token cap.
  COMPOSE_ASSIST_ENABLED: z.enum(["true", "false"]).optional(),
  // AI follow-up drafts: style-aware, deterministic nudge body fallback.
  FOLLOWUP_AI_ENABLED: z.enum(["true", "false"]).optional(),
  // Meeting briefs: cached per (event, attendees, day); one standard call.
  MEETING_BRIEFS_ENABLED: z.enum(["true", "false"]).optional(),
  // Digest: one batched call per generated digest; cached until next period.
  DIGEST_ENABLED: z.enum(["true", "false"]).optional(),
  // AI thread status for Reply Zero; deterministic heuristic fallback.
  REPLY_STATUS_ENABLED: z.enum(["true", "false"]).optional(),

  /* --- Morning briefing, commitments & auto-memory (all optional) --- */

  // Interactive morning briefing thread + daily warm.
  BRIEFING_ENABLED: z.enum(["true", "false"]).optional(),
  // Promise/commitment extraction and overdue nudges.
  COMMITMENTS_ENABLED: z.enum(["true", "false"]).optional(),
  // Learn memories from every exchange (per-user setting still gates it, and
  // that setting defaults off).
  ASSISTANT_AUTO_MEMORY_ENABLED: z.enum(["true", "false"]).optional(),

  /* --- Phase 5 feature gates --- */

  // Weekly inbox insights report (one standard call, cached).
  INSIGHTS_ENABLED: z.enum(["true", "false"]).optional(),
  // Translate a draft/thread into another language.
  TRANSLATE_ENABLED: z.enum(["true", "false"]).optional(),
  // Ask-inbox hybrid search. Only enable once the eval evidence gate passes.
  SEMANTIC_SEARCH_ENABLED: z.enum(["true", "false"]).optional(),

  /* --- Phase 6 assets (images & files) --- */

  ASSETS_ENABLED: z.enum(["true", "false"]).optional(),
  // "vercel-blob" (default) | "s3".
  ASSET_STORAGE_DRIVER: z.string().min(1).optional(),
  // @vercel/blob read/write token (Vercel injects it as BLOB_READ_WRITE_TOKEN).
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
  // S3-compatible adapter (R2, MinIO, AWS). All required together for "s3".
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_ENDPOINT: z.string().url().optional(),
  // Per-asset size cap and allowed MIME globs (comma-separated).
  ASSET_MAX_BYTES: z.coerce.number().int().positive().optional(),
  ASSET_ALLOWED_MIME: z.string().min(1).optional(),
  // Vercel Blob access level. Defaults to "private": objects are only reachable
  // through the authenticated `/api/v1/assets/[id]/raw` proxy. Set "public" only
  // for a Blob store provisioned as public-access.
  ASSET_BLOB_ACCESS: z.enum(["public", "private"]).optional(),

  /* --- Attachment malware scanning + encrypted extraction --- */

  // "off" (default) skips scanning, "warn" scans and records the verdict but
  // still accepts, "enforce" rejects infected uploads and blocks sending them.
  ASSET_SCAN_MODE: z.enum(["off", "warn", "enforce"]).optional(),
  // clamd (`ClamAV`) TCP endpoint. Required when ASSET_SCAN_MODE != "off".
  CLAMAV_HOST: z.string().min(1).optional(),
  CLAMAV_PORT: z.coerce.number().int().positive().optional(),
  CLAMAV_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  // Extract text from a clean attachment and store it encrypted at rest.
  ASSET_EXTRACT_ENABLED: z.enum(["true", "false"]).optional(),
  // base64-encoded 32-byte key for AES-256-GCM. Required when extraction is on.
  ASSET_EXTRACT_KEY: z.string().min(1).optional(),
  ASSET_EXTRACT_MAX_CHARS: z.coerce.number().int().positive().optional(),

  /* --- Google API quota governance (Gmail + Calendar) --- */

  // Bucket key for the shared Google Cloud project quota. All connections in a
  // deployment share one project unless this is overridden.
  GOOGLE_QUOTA_PROJECT_KEY: z.string().min(1).optional(),
  // Per-minute unit ceilings. Defaults mirror Google's documented limits.
  GOOGLE_PROJECT_UNITS_PER_MIN: z.coerce.number().int().positive().optional(),
  GOOGLE_CONNECTION_UNITS_PER_MIN: z
    .coerce
    .number()
    .int()
    .positive()
    .optional(),
  // In-flight request ceiling per connected Google account.
  GOOGLE_MAX_CONCURRENT_PER_CONNECTION: z
    .coerce
    .number()
    .int()
    .positive()
    .optional(),
  // Circuit breaker: consecutive transient failures before a connection is
  // short-circuited, and how long it stays open.
  GOOGLE_CIRCUIT_FAILURE_THRESHOLD: z
    .coerce
    .number()
    .int()
    .positive()
    .optional(),
  GOOGLE_CIRCUIT_OPEN_MS: z.coerce.number().int().positive().optional(),
  // Retry policy for retryable Google responses (429/5xx/quota).
  GOOGLE_MAX_RETRIES: z.coerce.number().int().min(0).optional(),
  GOOGLE_RETRY_BASE_MS: z.coerce.number().int().positive().optional(),
  GOOGLE_RETRY_MAX_MS: z.coerce.number().int().positive().optional(),

  /* --- Phase 7 bulk campaigns --- */

  CAMPAIGNS_ENABLED: z.enum(["true", "false"]).optional(),
  CAMPAIGN_MAX_RECIPIENTS: z.coerce.number().int().positive().optional(),
  CAMPAIGN_BATCH_SIZE: z.coerce.number().int().positive().optional(),
  CAMPAIGN_MAX_PER_HOUR: z.coerce.number().int().positive().optional(),
  CAMPAIGN_MAX_PER_DAY: z.coerce.number().int().positive().optional(),
  // "off" | "drafts" (default) | "autopilot".
  CAMPAIGN_REPLY_AUTOMATION: z.enum(["off", "drafts", "autopilot"]).optional(),

  /* --- 24/7 autopilot (Plan-24-7-autopilot) --- */

  // Global kill switch for *unattended* sends. Unset means allowed; "false"
  // hard-disables every autopilot send platform-wide without a deploy. This
  // does not affect copilot drafts or manual approvals.
  AUTOPILOT_ENABLED: z.enum(["true", "false"]).optional(),
  // Platform ceilings that clamp a user's policy on write.
  AUTOPILOT_MAX_PER_HOUR: z.coerce.number().int().positive().optional(),
  AUTOPILOT_MAX_PER_DAY: z.coerce.number().int().positive().optional(),
  // Ceilings for the per-thread cap and loop threshold. A compromised session
  // must not be able to raise these high enough to defeat loop protection.
  AUTOPILOT_MAX_PER_THREAD: z.coerce.number().int().positive().optional(),
  AUTOPILOT_MAX_LOOP_THRESHOLD: z.coerce.number().int().positive().optional(),
  // Platform floor for min confidence ("HIGH" | "MEDIUM" | "LOW").
  AUTOPILOT_MIN_CONFIDENCE: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  // How many queue jobs the webhook `after()` drains inline. Clamped to the
  // queue's global concurrency.
  WEBHOOK_DRAIN_BATCH_SIZE: z.coerce.number().int().positive().optional(),
  // How long `autopilot_decisions` audit rows are retained.
  AUTOPILOT_DECISION_RETENTION_DAYS: z.coerce.number().int().positive().optional(),
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

/* -------------------------------------------------------------------------- */
/*  Operational hardening (Phase A)                                           */
/* -------------------------------------------------------------------------- */

/** Default per-user API ceiling, matching the skill's "general API" band. */
export const DEFAULT_API_RATE_LIMIT_PER_MIN = 300;
/** Expensive agent turns are rarer but cost model tokens. */
export const DEFAULT_AGENT_RATE_LIMIT_PER_MIN = 20;
/** Uploads buffer bytes in the function; keep them well bounded. */
export const DEFAULT_ASSET_RATE_LIMIT_PER_MIN = 30;

export function apiRateLimitPerMin(): number {
  return env.API_RATE_LIMIT_PER_MIN ?? DEFAULT_API_RATE_LIMIT_PER_MIN;
}

export function agentRateLimitPerMin(): number {
  return env.AGENT_RATE_LIMIT_PER_MIN ?? DEFAULT_AGENT_RATE_LIMIT_PER_MIN;
}

export function assetRateLimitPerMin(): number {
  return env.ASSET_RATE_LIMIT_PER_MIN ?? DEFAULT_ASSET_RATE_LIMIT_PER_MIN;
}

/**
 * Phase 0 §5.3 — progressive agent tool disclosure. Opt-in: it changes which
 * tools the model sees, so it stays off unless explicitly enabled.
 */
export function isProgressiveToolsEnabled(): boolean {
  return env.AGENT_PROGRESSIVE_TOOLS === "true";
}

/**
 * Phase 1 feature gates.
 *
 * The voice/memory/knowledge capabilities are additive and cached, so they ship
 * enabled by default; an operator hard-disables one with `...=false`. (The
 * riskier later phases invert this and default to off.) A gate is only ever a
 * coarse kill-switch: the per-user `assistant_settings` toggles still apply.
 */
export function isAssistantVoiceEnabled(): boolean {
  return env.ASSISTANT_VOICE_ENABLED !== "false";
}

export function isAssistantMemoryEnabled(): boolean {
  return env.ASSISTANT_MEMORY_ENABLED !== "false";
}

export function isAssistantKnowledgeEnabled(): boolean {
  return env.ASSISTANT_KNOWLEDGE_ENABLED !== "false";
}

/**
 * Phase 2 feature gates. Sender intelligence is deterministic-first and cached,
 * so it ships enabled; the individual capabilities each have their own gate.
 * `...=false` is a hard kill-switch; the per-user setting still applies.
 */
export function isSenderIntelligenceEnabled(): boolean {
  return env.SENDER_INTELLIGENCE_ENABLED !== "false";
}

export function isColdEmailBlockerEnabled(): boolean {
  return isSenderIntelligenceEnabled() && env.COLD_EMAIL_BLOCKER_ENABLED !== "false";
}

export function isSenderCategorizationEnabled(): boolean {
  return (
    isSenderIntelligenceEnabled() && env.SENDER_CATEGORIZATION_ENABLED !== "false"
  );
}

export function isThreadSummaryEnabled(): boolean {
  return env.THREAD_SUMMARY_ENABLED !== "false";
}

/** Phase 3: plain-English automation rules. */
export function isRulesEnabled(): boolean {
  return env.RULES_ENABLED !== "false";
}

/**
 * Phase 4 gates. Like Phase 1–3, the capabilities are cached/user-initiated and
 * always have a deterministic fallback, so they ship enabled and `=false` is a
 * hard kill-switch. The per-user `assistant_settings` toggle still applies.
 */
export function isComposeAssistEnabled(): boolean {
  return env.COMPOSE_ASSIST_ENABLED !== "false";
}

export function isFollowupAiEnabled(): boolean {
  return env.FOLLOWUP_AI_ENABLED !== "false";
}

export function isMeetingBriefsEnabled(): boolean {
  return env.MEETING_BRIEFS_ENABLED !== "false";
}

export function isDigestEnabled(): boolean {
  return env.DIGEST_ENABLED !== "false";
}

export function isReplyStatusEnabled(): boolean {
  return env.REPLY_STATUS_ENABLED !== "false";
}

/**
 * Morning briefing + commitments ship enabled (deterministic-first, cached, and
 * every outbound still goes through `egress`). `=false` is a hard kill-switch;
 * the per-user `assistant_settings` toggle still applies.
 */
export function isBriefingEnabled(): boolean {
  return env.BRIEFING_ENABLED !== "false";
}

export function isCommitmentsEnabled(): boolean {
  return env.COMMITMENTS_ENABLED !== "false";
}

/**
 * Auto-memory is opt-in twice over: this env gate ships on, but the per-user
 * `memoryAutoExtract` setting defaults off, so nothing is learned until the
 * user turns it on.
 */
export function isAssistantAutoMemoryEnabled(): boolean {
  return env.ASSISTANT_AUTO_MEMORY_ENABLED !== "false";
}

/** Phase 5 gates. Insights/translate ship on; semantic search is opt-in. */
export function isInsightsEnabled(): boolean {
  return env.INSIGHTS_ENABLED !== "false";
}

export function isTranslateEnabled(): boolean {
  return env.TRANSLATE_ENABLED !== "false";
}

/**
 * Semantic search is evidence-gated (§6 Phase 5): it ships **off** and is only
 * enabled once the eval shows keyword/trigram search is insufficient.
 */
export function isSemanticSearchEnabled(): boolean {
  return env.SEMANTIC_SEARCH_ENABLED === "true";
}

/* -------------------------------------------------------------------------- */
/*  Phase 6 — assets                                                          */
/* -------------------------------------------------------------------------- */

export const DEFAULT_ASSET_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_ASSET_ALLOWED_MIME = "image/*,application/pdf";
/** Gmail rejects a message over ~25 MB once base64-encoded. */
export const GMAIL_MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

/** Assets ship enabled; `=false` is a hard kill-switch. */
export function isAssetsEnabled(): boolean {
  return env.ASSETS_ENABLED !== "false";
}

export function assetMaxBytes(): number {
  return env.ASSET_MAX_BYTES ?? DEFAULT_ASSET_MAX_BYTES;
}

export function assetAllowedMime(): string[] {
  return (env.ASSET_ALLOWED_MIME ?? DEFAULT_ASSET_ALLOWED_MIME)
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/** "vercel-blob" by default; "s3" when explicitly configured. */
export function assetStorageDriver(): "vercel-blob" | "s3" {
  return env.ASSET_STORAGE_DRIVER === "s3" ? "s3" : "vercel-blob";
}

/**
 * Vercel Blob object access. Defaults to `private` so a leaked URL is not
 * enough to read someone's files; only the authenticated proxy can serve them.
 */
export function assetBlobAccess(): "public" | "private" {
  return env.ASSET_BLOB_ACCESS === "public" ? "public" : "private";
}

/* -------------------------------------------------------------------------- */
/*  Attachment malware scanning + encrypted extraction                        */
/* -------------------------------------------------------------------------- */

export type AssetScanMode = "off" | "warn" | "enforce";

export const DEFAULT_CLAMAV_PORT = 3310;
export const DEFAULT_CLAMAV_TIMEOUT_MS = 15_000;
export const DEFAULT_ASSET_EXTRACT_MAX_CHARS = 100_000;

/** Scanning is opt-in: `off` unless explicitly configured. */
export function assetScanMode(): AssetScanMode {
  const mode = env.ASSET_SCAN_MODE;
  return mode === "warn" || mode === "enforce" ? mode : "off";
}

/** Whether clamd is configured well enough to scan. */
export function isClamavConfigured(): boolean {
  return Boolean(env.CLAMAV_HOST);
}

export function clamavHost(): string {
  return env.CLAMAV_HOST ?? "";
}

export function clamavPort(): number {
  return env.CLAMAV_PORT ?? DEFAULT_CLAMAV_PORT;
}

export function clamavTimeoutMs(): number {
  return env.CLAMAV_TIMEOUT_MS ?? DEFAULT_CLAMAV_TIMEOUT_MS;
}

/** Extraction requires both the flag and a key; otherwise it is off. */
export function isAssetExtractionEnabled(): boolean {
  return env.ASSET_EXTRACT_ENABLED === "true" && Boolean(env.ASSET_EXTRACT_KEY);
}

export function assetExtractKey(): string | null {
  return env.ASSET_EXTRACT_KEY ?? null;
}

export function assetExtractMaxChars(): number {
  return env.ASSET_EXTRACT_MAX_CHARS ?? DEFAULT_ASSET_EXTRACT_MAX_CHARS;
}

/* -------------------------------------------------------------------------- */
/*  Google API quota governance                                               */
/* -------------------------------------------------------------------------- */

export const DEFAULT_GOOGLE_PROJECT_UNITS_PER_MIN = 1_200_000;
export const DEFAULT_GOOGLE_CONNECTION_UNITS_PER_MIN = 6_000;
export const DEFAULT_GOOGLE_MAX_CONCURRENT_PER_CONNECTION = 5;
export const DEFAULT_GOOGLE_CIRCUIT_FAILURE_THRESHOLD = 8;
export const DEFAULT_GOOGLE_CIRCUIT_OPEN_MS = 30_000;
export const DEFAULT_GOOGLE_MAX_RETRIES = 3;
export const DEFAULT_GOOGLE_RETRY_BASE_MS = 250;
export const DEFAULT_GOOGLE_RETRY_MAX_MS = 4_000;

export function googleQuotaProjectKey(): string {
  return env.GOOGLE_QUOTA_PROJECT_KEY ?? "default";
}

export function googleProjectUnitsPerMin(): number {
  return env.GOOGLE_PROJECT_UNITS_PER_MIN ?? DEFAULT_GOOGLE_PROJECT_UNITS_PER_MIN;
}

export function googleConnectionUnitsPerMin(): number {
  return (
    env.GOOGLE_CONNECTION_UNITS_PER_MIN ??
    DEFAULT_GOOGLE_CONNECTION_UNITS_PER_MIN
  );
}

export function googleMaxConcurrentPerConnection(): number {
  return (
    env.GOOGLE_MAX_CONCURRENT_PER_CONNECTION ??
    DEFAULT_GOOGLE_MAX_CONCURRENT_PER_CONNECTION
  );
}

export function googleCircuitFailureThreshold(): number {
  return (
    env.GOOGLE_CIRCUIT_FAILURE_THRESHOLD ??
    DEFAULT_GOOGLE_CIRCUIT_FAILURE_THRESHOLD
  );
}

export function googleCircuitOpenMs(): number {
  return env.GOOGLE_CIRCUIT_OPEN_MS ?? DEFAULT_GOOGLE_CIRCUIT_OPEN_MS;
}

export function googleMaxRetries(): number {
  return env.GOOGLE_MAX_RETRIES ?? DEFAULT_GOOGLE_MAX_RETRIES;
}

export function googleRetryBaseMs(): number {
  return env.GOOGLE_RETRY_BASE_MS ?? DEFAULT_GOOGLE_RETRY_BASE_MS;
}

export function googleRetryMaxMs(): number {
  return env.GOOGLE_RETRY_MAX_MS ?? DEFAULT_GOOGLE_RETRY_MAX_MS;
}

/* -------------------------------------------------------------------------- */
/*  Phase 7 — campaigns                                                       */
/* -------------------------------------------------------------------------- */

export const DEFAULT_CAMPAIGN_MAX_RECIPIENTS = 5_000;
export const DEFAULT_CAMPAIGN_BATCH_SIZE = 20;
export const DEFAULT_CAMPAIGN_MAX_PER_HOUR = 50;
export const DEFAULT_CAMPAIGN_MAX_PER_DAY = 200;

/** Campaigns ship **off** — bulk sending is the riskiest surface in the plan. */
export function isCampaignsEnabled(): boolean {
  return env.CAMPAIGNS_ENABLED === "true";
}

export function campaignMaxRecipients(): number {
  return env.CAMPAIGN_MAX_RECIPIENTS ?? DEFAULT_CAMPAIGN_MAX_RECIPIENTS;
}

export function campaignBatchSize(): number {
  return env.CAMPAIGN_BATCH_SIZE ?? DEFAULT_CAMPAIGN_BATCH_SIZE;
}

export function campaignMaxPerHour(): number {
  return env.CAMPAIGN_MAX_PER_HOUR ?? DEFAULT_CAMPAIGN_MAX_PER_HOUR;
}

export function campaignMaxPerDay(): number {
  return env.CAMPAIGN_MAX_PER_DAY ?? DEFAULT_CAMPAIGN_MAX_PER_DAY;
}

export type CampaignReplyPolicy = "off" | "drafts" | "autopilot";

export function campaignReplyPolicy(): CampaignReplyPolicy {
  return env.CAMPAIGN_REPLY_AUTOMATION === "off" ||
    env.CAMPAIGN_REPLY_AUTOMATION === "autopilot"
    ? env.CAMPAIGN_REPLY_AUTOMATION
    : "drafts";
}

/* -------------------------------------------------------------------------- */
/*  24/7 autopilot                                                            */
/* -------------------------------------------------------------------------- */

export type AutopilotConfidence = "HIGH" | "MEDIUM" | "LOW";

export const DEFAULT_AUTOPILOT_MAX_PER_HOUR = 10;
export const DEFAULT_AUTOPILOT_MAX_PER_DAY = 50;
export const DEFAULT_AUTOPILOT_MAX_PER_THREAD = 10;
export const DEFAULT_AUTOPILOT_MAX_LOOP_THRESHOLD = 10;
export const DEFAULT_AUTOPILOT_MIN_CONFIDENCE: AutopilotConfidence = "HIGH";
export const DEFAULT_WEBHOOK_DRAIN_BATCH_SIZE = 5;
export const DEFAULT_AUTOPILOT_DECISION_RETENTION_DAYS = 90;

/**
 * Global kill switch. Unset/`true` = allowed; `false` = no unattended sends
 * anywhere. Per-mailbox policies must still be enabled on top of this.
 */
export function isAutopilotEnabled(): boolean {
  return env.AUTOPILOT_ENABLED !== "false";
}

export function autopilotMaxPerHour(): number {
  return env.AUTOPILOT_MAX_PER_HOUR ?? DEFAULT_AUTOPILOT_MAX_PER_HOUR;
}

export function autopilotMaxPerDay(): number {
  return env.AUTOPILOT_MAX_PER_DAY ?? DEFAULT_AUTOPILOT_MAX_PER_DAY;
}

/** Platform ceiling for a policy's `maxPerThread`. */
export function autopilotMaxPerThread(): number {
  return env.AUTOPILOT_MAX_PER_THREAD ?? DEFAULT_AUTOPILOT_MAX_PER_THREAD;
}

/** Platform ceiling for a policy's `loopThreshold`. */
export function autopilotMaxLoopThreshold(): number {
  return env.AUTOPILOT_MAX_LOOP_THRESHOLD ?? DEFAULT_AUTOPILOT_MAX_LOOP_THRESHOLD;
}

export function autopilotMinConfidence(): AutopilotConfidence {
  return env.AUTOPILOT_MIN_CONFIDENCE ?? DEFAULT_AUTOPILOT_MIN_CONFIDENCE;
}

export function autopilotDecisionRetentionDays(): number {
  return (
    env.AUTOPILOT_DECISION_RETENTION_DAYS ??
    DEFAULT_AUTOPILOT_DECISION_RETENTION_DAYS
  );
}

/**
 * Webhook inline drain batch size, clamped to the queue's global concurrency
 * (`QUEUE_MAX_CONCURRENCY`). Read directly from `process.env` to avoid an
 * `env -> drain -> redis -> env` import cycle.
 */
export function webhookDrainBatchSize(): number {
  const configured =
    env.WEBHOOK_DRAIN_BATCH_SIZE ?? DEFAULT_WEBHOOK_DRAIN_BATCH_SIZE;
  const rawMax = Number(process.env.QUEUE_MAX_CONCURRENCY);
  const ceiling =
    Number.isFinite(rawMax) && rawMax > 0 ? rawMax : configured;
  return Math.max(1, Math.min(configured, ceiling));
}
