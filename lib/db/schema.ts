import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Better Auth core tables (Google OAuth only).
 * Field names match Better Auth's default expectations so no
 * `fields` mapping is needed in the auth config.
 */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .$onUpdate(() => new Date())
    .notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .$onUpdate(() => new Date())
    .notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

/* -------------------------------------------------------------------------- */
/*  Onboarding (single-tenant)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Per-user onboarding state machine. This replaces Twenty's
 * workspace-scoped `userVars` because we are single-tenant: there is no
 * workspace to scope to, so the user row *is* the scope.
 */
export const onboardingState = pgTable("onboarding_state", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("PROFILE_CREATION"),
  previousStatus: text("previous_status"),
  // Stack of reversible steps, oldest first. Mirrors Twenty's
  // ONBOARDING_REVERSIBLE_STEP_HISTORY.
  reversibleHistory: jsonb("reversible_history")
    .$type<string[]>()
    .notNull()
    .default([]),
  navigationDirection: text("navigation_direction").notNull().default("forward"),
  jobTitle: text("job_title"),
  // Avatar chosen during onboarding. Kept here (not on the auth `user.image`)
  // because Better Auth embeds the user object in the session cookie, and a
  // data URL would blow past the 4KB cookie limit.
  avatarUrl: text("avatar_url"),
  connectedEmailProvider: text("connected_email_provider"),
  connectedCalendarProvider: text("connected_calendar_provider"),
  calendarTimezone: text("calendar_timezone"),
  installedApps: jsonb("installed_apps")
    .$type<string[]>()
    .notNull()
    .default([]),
  invitedEmails: jsonb("invited_emails")
    .$type<string[]>()
    .notNull()
    .default([]),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

/* -------------------------------------------------------------------------- */
/*  Agent chat                                                                 */
/* -------------------------------------------------------------------------- */

export const agentChatThread = pgTable(
  "agent_chat_thread",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    // Marks the deterministic onboarding "workspace setup" thread.
    isWorkspaceSetup: boolean("is_workspace_setup").notNull().default(false),
    /**
     * "chat" | "briefing". The briefing thread is the persistent morning-brief
     * conversation; a partial unique index keeps exactly one per user.
     */
    kind: text("kind").notNull().default("chat"),
    // Archive marker (Twenty uses `deletedAt` for the same purpose).
    archivedAt: timestamp("archived_at"),
    lastMessageAt: timestamp("last_message_at"),
    /**
     * Bounded-context compaction (A3). `compactionSummary` is the framed
     * historical summary the model sees in place of the compacted messages;
     * `compactedBefore` is the id of the oldest message still kept verbatim, so
     * a later turn can tell what the summary already covers.
     */
    compactionSummary: text("compaction_summary"),
    compactedBefore: text("compacted_before"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  // The sidebar lists a user's threads newest-first; Postgres does not index
  // FK columns automatically.
  (t) => [
    index("agent_chat_thread_user_updated_idx").on(t.userId, t.updatedAt),
    // One persistent briefing thread per user.
    uniqueIndex("agent_chat_thread_briefing_unique")
      .on(t.userId)
      .where(sql`${t.kind} = 'briefing'`),
  ],
);

/**
 * A stored assistant/user message part.
 *
 * The persisted shape mirrors the AI SDK's `UIMessage` part union closely enough
 * that a stored row can be rehydrated into `useChat`'s `initialMessages`
 * without a lossy transform. Text-only messages (the original format) remain
 * valid, so existing rows and the workspace-setup flow keep working.
 */
export type ChatTextPart = { type: "text"; text: string };
export type ChatReasoningPart = { type: "reasoning"; text: string };
export type ChatToolPart = {
  /** `tool-<name>` — the AI SDK's naming for a typed tool UI part. */
  type: `tool-${string}`;
  toolCallId: string;
  /** "input-streaming" | "input-available" | "output-available" | "output-error" … */
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

/**
 * A single actionable card inside the morning briefing. One part per card, so
 * the transcript renders (and rehydrates) them exactly like tool artifacts.
 * `brief` is structural on purpose: it keeps this server-adjacent schema free
 * of `server-only` imports while still typing the meeting card.
 */
export type ChatBriefingPart = {
  type: "briefing";
  kind: "reply" | "followup" | "promise" | "meeting";
  threadId?: string;
  draftId?: string;
  enrollmentId?: string;
  commitmentId?: string;
  meetingId?: string;
  title: string;
  subtitle?: string;
  summary?: string;
  /** Prepared draft text, when a draft is ready to send. */
  body?: string;
  brief?: {
    summary: string;
    attendees: string[];
    lastTouch: string | null;
    talkingPoints: string[];
    openItems: string[];
    objective?: string | null;
    agenda?: string[];
    outstandingQuestions?: string[];
    lastProposal?: string | null;
    relevantEmails?: Array<{
      threadId: string;
      subject: string | null;
      when: string | null;
    }>;
    source: "model" | "heuristic";
    generatedAt: string;
  };
  actions: Array<"send" | "edit" | "tomorrow" | "ignore" | "view_brief">;
};

export type ChatMessagePart =
  | ChatTextPart
  | ChatReasoningPart
  | ChatToolPart
  | ChatBriefingPart;

export const agentChatMessage = pgTable(
  "agent_chat_message",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => agentChatThread.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // "user" | "assistant" | "system"
    parts: jsonb("parts").$type<ChatMessagePart[]>().notNull().default([]),
    // Hidden messages (e.g. the workspace-setup kickoff prompt) are sent to the
    // model but never rendered in the chat UI.
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  // Every conversation read filters by thread and orders by time.
  (t) => [
    index("agent_chat_message_thread_created_idx").on(t.threadId, t.createdAt),
  ],
);

/**
 * One bounded agent execution: the observability record for a single assistant
 * turn. `trace` captures the ordered tool calls (name, risk, status, ms) so the
 * UI, evals and debugging can reconstruct what the agent actually did, without
 * logging email bodies or secrets.
 */
export type AgentTraceEntry = {
  step: number;
  kind: "model" | "tool";
  toolName?: string;
  risk?: string;
  status: "ok" | "error" | "denied";
  ms: number;
  detail?: unknown;
};

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => agentChatThread.id, { onDelete: "cascade" }),
    /** Correlates route logs, this row and the trace. */
    requestId: text("request_id").notNull(),
    /** "running" | "completed" | "failed" | "aborted" | "limit_reached". */
    status: text("status").notNull().default("running"),
    model: text("model"),
    stepCount: integer("step_count").notNull().default(0),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    latencyMs: integer("latency_ms"),
    /** Safe, truncated message — never a raw stack or provider payload. */
    error: text("error"),
    trace: jsonb("trace").$type<AgentTraceEntry[]>().notNull().default([]),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("agent_runs_user_started_idx").on(t.userId, t.startedAt)],
);

/* -------------------------------------------------------------------------- */
/*  Agent runtime — confirmation + scheduled side effects                      */
/* -------------------------------------------------------------------------- */

/** Lifecycle of a server-verified side-effect consent row. */
export type PendingActionStatus =
  | "PENDING"
  | "EXECUTING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

/**
 * A model-proposed external side effect awaiting the user's explicit consent.
 *
 * The model's decision to call a tool is *not* consent: consent is the atomic
 * `PENDING → EXECUTING` transition on this row, performed by an authenticated
 * request. `arguments` are validated and frozen at creation; `argumentsHash`
 * lets confirmation detect any drift, and `idempotencyKey` (unique) makes the
 * eventual send at-most-once.
 */
export const pendingActions = pgTable(
  "pending_actions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => agentChatThread.id, { onDelete: "cascade" }),
    /** The assistant message part that rendered the confirmation card. */
    messageId: text("message_id"),
    toolName: text("tool_name").notNull(),
    /** Validated arguments, immutable after creation. */
    arguments: jsonb("arguments")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** sha256 of the canonical arguments, verified at confirm time. */
    argumentsHash: text("arguments_hash").notNull(),
    /** "gmail" | … — the integration the action will touch. */
    provider: text("provider").notNull(),
    status: text("status")
      .$type<PendingActionStatus>()
      .notNull()
      .default("PENDING"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("pending_actions_user_status_idx").on(t.userId, t.status),
    index("pending_actions_user_created_idx").on(t.userId, t.createdAt),
    // Access path for the realtime stream: "what changed for this user since T".
    index("pending_actions_user_updated_idx").on(t.userId, t.updatedAt),
  ],
);

/**
 * A future-dated action driven by the existing Postgres `job_queue` (enqueued
 * with `runAfter`), not a new Redis queue. One row per scheduled execution.
 */
export const scheduledActions = pgTable(
  "scheduled_actions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pendingActionId: text("pending_action_id")
      .notNull()
      .references(() => pendingActions.id, { onDelete: "cascade" }),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull(),
    /** "pending" | "enqueued" | "done" | "cancelled" | "failed". */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("scheduled_actions_due_idx").on(t.status, t.runAfter),
    index("scheduled_actions_pending_action_idx").on(
      t.userId,
      t.pendingActionId,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Research — cached third-party lookups                                      */
/* -------------------------------------------------------------------------- */

/**
 * Cache for web research results. Postgres first (per the plan); Redis only if
 * a measured need appears. Keyed per user so one user's lookups never leak into
 * another's context.
 */
export const researchCache = pgTable(
  "research_cache",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    cacheKey: text("cache_key").notNull(),
    provider: text("provider").notNull(),
    query: text("query").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("research_cache_user_key_unique").on(t.userId, t.cacheKey),
    index("research_cache_expiry_idx").on(t.expiresAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Email operator — connections + mirrors                                     */
/* -------------------------------------------------------------------------- */

/** One connected inbox per Google account. Holds the sync cursor + autonomy. */
export const mailboxes = pgTable(
  "mailboxes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    provider: text("provider").notNull().default("google"),
    /** Gmail history cursor used by `users.history.list` incremental sync. */
    historyId: text("history_id"),
    watchExpiration: timestamp("watch_expiration", { withTimezone: true }),
    /** "copilot" (draft for approval) | "autopilot" (send directly). */
    autonomy: text("autonomy").notNull().default("copilot"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    /**
     * Short, content-free sync failure marker (no bodies/tokens). Surfaced by
     * the watch/sync health panel so a silently stalled mailbox is visible.
     */
    syncError: text("sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("mailboxes_user_email_unique").on(t.userId, t.email),
    index("mailboxes_user_idx").on(t.userId),
  ],
);

/** Local mirror of a Gmail thread. Gmail stays canonical for actions. */
export const threads = pgTable(
  "threads",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    gmailThreadId: text("gmail_thread_id").notNull().unique(),
    subject: text("subject"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    labels: jsonb("labels").$type<string[]>().notNull().default([]),
    isUnread: boolean("is_unread").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("threads_user_last_message_idx").on(t.userId, t.lastMessageAt),
  ],
);

/**
 * The unsubscribe-relevant headers of one message (Phase 2).
 *
 * Captured at parse time so sender intelligence can classify bulk/newsletter
 * mail deterministically — with no model call — and so the unsubscribe action
 * knows the exact mechanism without re-reading Gmail. Headers only; never bodies.
 */
export type MessageUnsubscribeInfo = {
  /** A `http(s)://` one-click endpoint, when present. */
  url?: string;
  /** A `mailto:` unsubscribe address, when present. */
  mailto?: string;
  /** `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). */
  oneClick: boolean;
  listId?: string;
  precedence?: string;
};

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    gmailMessageId: text("gmail_message_id").notNull().unique(),
    direction: text("direction").notNull(), // "inbound" | "outbound"
    fromAddr: text("from_addr"),
    toAddr: jsonb("to_addr").$type<string[]>().notNull().default([]),
    subject: text("subject"),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    snippet: text("snippet"),
    /** Bulk-mail headers (List-Unsubscribe / List-Id / Precedence). */
    unsubscribe: jsonb("unsubscribe").$type<MessageUnsubscribeInfo | null>(),
    /**
     * True when the message carries an auto-reply/bounce marker
     * (`Auto-Submitted`, `X-Autoreply`). Used by the `auto_responder`
     * guardrail so autopilot never replies to robots. Header only; no content.
     */
    autoSubmitted: boolean("auto_submitted"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("messages_thread_sent_idx").on(t.threadId, t.sentAt)],
);

/** People the operator has seen, with per-contact autonomy overrides. */
export const contacts = pgTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    nameLower: text("name_lower"),
    source: text("source"),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    /** null = inherit mailbox autonomy; otherwise "copilot" | "autopilot". */
    autonomyOverride: text("autonomy_override"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex("contacts_user_email_unique").on(t.userId, t.email)],
);

/** Per-thread triage result, written by the `triage` step. */
export const threadStates = pgTable("thread_states", {
  threadId: text("thread_id")
    .primaryKey()
    .references(() => threads.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  /** Importance score 0–100 (also the sort priority of the inbox). */
  priority: integer("priority").notNull().default(0),
  action: text("action").notNull(),
  /** One short, user-facing line: *why* triage decided this ("matched because…"). */
  reason: text("reason"),
  /** Pipeline version that produced this row, for attribution (Phase 2). */
  triageVersion: text("triage_version"),
  /**
   * Phase 4 Reply Zero: whether the ball is in the user's court. "needs_reply"
   * (they must answer), "awaiting_them" (waiting on the other side), or "none"
   * (FYI/no reply needed). Null until computed. AI-assisted with a deterministic
   * heuristic fallback.
   */
  replyStatus: text("reply_status"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

/** Working-hours profile used to compute bookable slots. */
export const calendarSettings = pgTable("calendar_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("UTC"),
  /** ISO weekday numbers, 1 = Monday … 7 = Sunday. */
  workDays: jsonb("work_days").$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
  workStartHour: integer("work_start_hour").notNull().default(9),
  workEndHour: integer("work_end_hour").notNull().default(18),
  bufferMins: integer("buffer_mins").notNull().default(15),
  defaultDurationMins: integer("default_duration_mins").notNull().default(30),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

/* -------------------------------------------------------------------------- */
/*  Email operator — durable work primitives                                   */
/* -------------------------------------------------------------------------- */

/** Webhook/mail events, deduped per user on the provider's external id. */
export const eventLog = pgTable(
  "event_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    externalId: text("external_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("event_log_user_external_unique").on(t.userId, t.externalId)],
);

/**
 * Idempotency ledger for outbound sends. The unique `idempotencyKey` makes a
 * retried drain (or a double-fired cron) incapable of sending twice.
 */
export const sendLedger = pgTable("send_ledger", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  jobId: text("job_id"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: text("status").notNull(),
  seq: integer("seq").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/* -------------------------------------------------------------------------- */
/*  Email operator — flow engine + durable queue                               */
/* -------------------------------------------------------------------------- */

/**
 * Durable Postgres queue (ported from DeskcommCRM's `job_queue`). One row per
 * unit of work; `laneKey` serializes work for the same thread.
 */
export const jobQueue = pgTable(
  "job_queue",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Serialization key, e.g. `thread:<id>`. One running job per lane. */
    laneKey: text("lane_key"),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("pending"),
    priority: integer("priority").notNull().default(100),
    runAfter: timestamp("run_after", { withTimezone: true })
      .defaultNow()
      .notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastError: text("last_error"),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    sourceEventId: text("source_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("job_queue_user_source_unique").on(t.userId, t.sourceEventId),
    index("job_queue_claim_idx")
      .on(t.runAfter)
      .where(sql`status = 'pending'`),
    uniqueIndex("job_queue_one_running_per_lane")
      .on(t.laneKey)
      .where(sql`status = 'running'`),
  ],
);

/** A saved automation graph (the `inbound-email` flow, follow-up cadences). */
export const flows = pgTable("flows", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  graph: jsonb("graph").$type<Record<string, unknown>>().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const flowRuns = pgTable(
  "flow_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    flowId: text("flow_id")
      .notNull()
      .references(() => flows.id, { onDelete: "cascade" }),
    triggerKind: text("trigger_kind").notNull(),
    status: text("status").notNull().default("running"),
    state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
    error: jsonb("error").$type<Record<string, unknown> | null>(),
    trace: jsonb("trace").$type<TraceEntry[]>().notNull().default([]),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  // Metrics list a user's runs by start time.
  (t) => [index("flow_runs_user_started_idx").on(t.userId, t.startedAt)],
);

export const flowCheckpoints = pgTable("flow_checkpoints", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => flowRuns.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  status: text("status").notNull(),
  output: jsonb("output").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type TraceEntry = {
  nodeId: string;
  type: string;
  status: "ok" | "error";
  ms: number;
  output?: unknown;
};

/* -------------------------------------------------------------------------- */
/*  Email operator — meetings                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A booked meeting. `(threadId, proposalId)` is unique so re-running a flow
 * updates the same event instead of creating a duplicate.
 */
export const meetings = pgTable(
  "meetings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    threadId: text("thread_id").references(() => threads.id, {
      onDelete: "cascade",
    }),
    calendarEventId: text("calendar_event_id").unique(),
    proposalId: text("proposal_id"),
    subject: text("subject"),
    startAt: timestamp("start_at", { withTimezone: true }),
    endAt: timestamp("end_at", { withTimezone: true }),
    meetLink: text("meet_link"),
    /** "proposed" | "confirmed" | "cancelled". */
    status: text("status").notNull().default("proposed"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("meetings_thread_proposal_unique").on(t.threadId, t.proposalId),
    index("meetings_user_start_idx").on(t.userId, t.startAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Email operator — follow-ups                                                */
/* -------------------------------------------------------------------------- */

/** A reusable follow-up cadence (`send → wait → condition → send → end`). */
export const followupSequences = pgTable("followup_sequences", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  graph: jsonb("graph").$type<Record<string, unknown>>().notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * One thread's progress through a follow-up cadence. `nextEvalAt` is when the
 * next nudge is due; the `followups` cron picks up due rows.
 */
export const followupEnrollments = pgTable(
  "followup_enrollments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    sequenceId: text("sequence_id").references(() => followupSequences.id, {
      onDelete: "set null",
    }),
    stage: text("stage").notNull().default("waiting"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextEvalAt: timestamp("next_eval_at", { withTimezone: true }),
    /** "active" | "paused" | "completed" | "stopped". */
    status: text("status").notNull().default("active"),
    stopReason: text("stop_reason"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("followup_enrollments_due_idx").on(t.status, t.nextEvalAt),
    index("followup_enrollments_thread_idx").on(t.threadId, t.status),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Commitments (promises)                                                     */
/* -------------------------------------------------------------------------- */

export const COMMITMENT_DIRECTIONS = ["we_owe", "they_owe"] as const;
export const COMMITMENT_STATUSES = [
  "open",
  "fulfilled",
  "cancelled",
  "expired",
] as const;
export type CommitmentDirection = (typeof COMMITMENT_DIRECTIONS)[number];
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

/**
 * A promise made in a thread, in either direction. `we_owe` is something the
 * user promised to do ("I'll send the deck"); `they_owe` is something the other
 * side promised. Overdue rows surface a chaser/reminder draft — never a send.
 */
export const commitments = pgTable(
  "commitments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    threadId: text("thread_id").references(() => threads.id, {
      onDelete: "set null",
    }),
    contactEmail: text("contact_email"),
    direction: text("direction").$type<CommitmentDirection>().notNull(),
    description: text("description").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    /** "open" | "fulfilled" | "cancelled" | "expired". */
    status: text("status").$type<CommitmentStatus>().notNull().default("open"),
    sourceMessageId: text("source_message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    confidence: text("confidence"),
    /** Last nudge attempt, so the chaser job is idempotent + bounded. */
    nudgedAt: timestamp("nudged_at", { withTimezone: true }),
    nudgeCount: integer("nudge_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("commitments_user_status_idx").on(t.userId, t.status, t.dueAt),
    index("commitments_thread_idx").on(t.threadId),
    index("commitments_contact_idx").on(t.userId, t.contactEmail),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Per-thread settings (autonomy)                                             */
/* -------------------------------------------------------------------------- */

/**
 * Per-thread autonomy override. `null` means "inherit contact → mailbox"; an
 * explicit `copilot` / `autopilot` wins in both directions (it steers the
 * background inbound operator as well as manual drafting).
 */
export const threadSettings = pgTable(
  "thread_settings",
  {
    threadId: text("thread_id")
      .primaryKey()
      .references(() => threads.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    autonomy: text("autonomy"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("thread_settings_user_idx").on(t.userId)],
);

/* -------------------------------------------------------------------------- */
/*  Email operator — copilot drafts                                            */
/* -------------------------------------------------------------------------- */

/** An AI-drafted reply awaiting the user's approval (or already decided). */
export const drafts = pgTable(
  "drafts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => flowRuns.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    editedBody: text("edited_body"),
    /**
     * Model-reported confidence for an AI draft (LOW|MEDIUM|HIGH). Null for
     * non-AI drafts or legacy rows. Below the user's threshold the row is kept
     * but `suppressed`, so the "Needs you" queue stays trustworthy.
     */
    confidence: text("confidence"),
    suppressed: boolean("suppressed").notNull().default(false),
    /** Prompt/routing version that produced the draft, for attribution. */
    pipelineVersion: text("pipeline_version"),
    /** "pending" | "sent" | "discarded". */
    status: text("status").notNull().default("pending"),
    /**
     * Who caused the send: `"user"` for a manual approval/click, `"ai"` when
     * the background operator sent on its own. Null until sent. Powers the
     * "AI handled" inbox bucket.
     */
    sentBy: text("sent_by").$type<"user" | "ai" | null>(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("drafts_thread_status_idx").on(t.threadId, t.status),
    index("drafts_user_status_idx").on(t.userId, t.status),
    // Powers the autopilot send caps: count AI sends in the last hour/day.
    index("drafts_user_sentby_decided_idx").on(
      t.userId,
      t.sentBy,
      t.decidedAt,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/*  24/7 autopilot — policy + content-free decision audit                      */
/* -------------------------------------------------------------------------- */

/**
 * The mailbox-scoped send policy for 24/7 Autopilot. Disabled by default; the
 * user opts in. `mode` gates *when* it may send; the remaining fields gate
 * *what* it may send. Caps are clamped to the platform ceilings on write.
 */
export const autopilotPolicies = pgTable(
  "autopilot_policies",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    /** Opt-in. Off unless the user enables it. */
    enabled: boolean("enabled").notNull().default(false),
    /** "window" (send only inside the window) | "always". */
    mode: text("mode").notNull().default("window"),
    timezone: text("timezone").notNull().default("UTC"),
    /** ISO weekdays (1=Mon..7=Sun) the window applies to. */
    days: jsonb("days").$type<number[]>().notNull().default([1, 2, 3, 4, 5, 6, 7]),
    /** Local hour 0..23. Wrapping windows (e.g. 22 → 7) are supported. */
    windowStartHour: integer("window_start_hour").notNull().default(22),
    windowEndHour: integer("window_end_hour").notNull().default(7),
    /** "HIGH" | "MEDIUM" | "LOW" — the minimum model confidence to auto-send. */
    minConfidence: text("min_confidence").notNull().default("HIGH"),
    requireKnownSender: boolean("require_known_sender").notNull().default(true),
    allowedCategories: jsonb("allowed_categories")
      .$type<string[]>()
      .notNull()
      .default(["needs_reply"]),
    maxPerHour: integer("max_per_hour").notNull().default(10),
    maxPerDay: integer("max_per_day").notNull().default(50),
    maxPerThread: integer("max_per_thread").notNull().default(3),
    /** Stop auto-replying after N consecutive automated exchanges in a thread. */
    loopThreshold: integer("loop_threshold").notNull().default(3),
    morningReview: boolean("morning_review").notNull().default(true),
    policyVersion: integer("policy_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("autopilot_policies_mailbox_unique").on(t.mailboxId),
    index("autopilot_policies_user_idx").on(t.userId),
  ],
);

/**
 * One row per `egress` evaluation on the autopilot path (allowed or blocked).
 *
 * Deliberately **content-free** (INV-11): IDs, reason code, category,
 * confidence and boolean checks only — never subject, body or tokens. The UI
 * joins to `threads` for display, scoped by `user_id`.
 */
export const autopilotDecisions = pgTable(
  "autopilot_decisions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    threadId: text("thread_id").references(() => threads.id, {
      onDelete: "set null",
    }),
    runId: text("run_id").references(() => flowRuns.id, {
      onDelete: "set null",
    }),
    draftId: text("draft_id").references(() => drafts.id, {
      onDelete: "set null",
    }),
    contactEmail: text("contact_email"),
    /** "send" | "draft". */
    decision: text("decision").notNull(),
    reason: text("reason").notNull(),
    /** thread | contact | mailbox. */
    autonomySource: text("autonomy_source"),
    category: text("category"),
    confidence: text("confidence"),
    /** Boolean check outcomes only — never message content. */
    checks: jsonb("checks").$type<Record<string, boolean>>(),
    policyVersion: integer("policy_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("autopilot_decisions_user_created_idx").on(t.userId, t.createdAt),
    index("autopilot_decisions_thread_idx").on(t.threadId, t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*  AI upgrade — cross-feature usage ledger                                    */
/* -------------------------------------------------------------------------- */

/**
 * One model call, across every feature (A4/A8). `agent_runs` remains the
 * agent-specific trace; this is the cost/observability ledger the platform-wide
 * budget and the `/activity` cost board read.
 */
export const aiUsageEvents = pgTable(
  "ai_usage_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Feature label for attribution, e.g. "triage", "draft-reply". */
    feature: text("feature").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    role: text("role").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    /** Cost estimate in millionths of a dollar (integer micro-USD). */
    estimatedCostMicros: integer("estimated_cost_micros").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    ok: boolean("ok").notNull().default(true),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("ai_usage_events_user_created_idx").on(t.userId, t.createdAt),
    index("ai_usage_events_feature_created_idx").on(t.feature, t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Phase 1 — voice, memory, knowledge, snippets                               */
/* -------------------------------------------------------------------------- */

/**
 * Per-user assistant configuration: the learned/explicit writing style, the
 * draft-confidence gate, and the per-user capability toggles.
 */
export const assistantSettings = pgTable("assistant_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Structured style profile learned from sent mail (see analyzeWritingStyle). */
  writingStyle: jsonb("writing_style").$type<WritingStyleProfile | null>(),
  /** Human-readable style guide, injected verbatim into the draft prompt. */
  learnedWritingStyle: text("learned_writing_style"),
  /** Explicit style the user typed; overrides the learned one when set. */
  explicitWritingStyle: text("explicit_writing_style"),
  /** Bumped whenever the style pipeline changes, so quality is attributable. */
  styleVersion: integer("style_version").notNull().default(1),
  styleAnalyzedAt: timestamp("style_analyzed_at", { withTimezone: true }),
  /** "all" | "standard" | "high" — the minimum confidence a draft must meet. */
  draftConfidence: text("draft_confidence").notNull().default("all"),
  voiceEnabled: boolean("voice_enabled").notNull().default(true),
  memoryEnabled: boolean("memory_enabled").notNull().default(true),
  knowledgeEnabled: boolean("knowledge_enabled").notNull().default(true),
  /** Phase 2: sender intelligence master switch (cold email + categories). */
  senderIntelEnabled: boolean("sender_intel_enabled").notNull().default(true),
  /** What to do with a cold-email verdict: "label" | "archive" | "none". */
  coldEmailAction: text("cold_email_action").notNull().default("label"),
  /** Auto-archive newsletters/marketing on arrival (deterministic signal only). */
  autoArchiveNoise: boolean("auto_archive_noise").notNull().default(false),
  /** Phase 4: meeting briefs are opt-out. */
  meetingBriefsEnabled: boolean("meeting_briefs_enabled").notNull().default(true),
  /** Phase 4: digest cadence — "off" | "daily" | "weekly". */
  digestFrequency: text("digest_frequency").notNull().default("off"),
  /** Last time a digest was generated for this user (cron throttle). */
  digestLastGeneratedAt: timestamp("digest_last_generated_at", {
    withTimezone: true,
  }),
  /* --- Morning briefing, commitments & auto-memory --- */
  /** The interactive morning-briefing thread ships on; opt out here. */
  briefingEnabled: boolean("briefing_enabled").notNull().default(true),
  /** Local hour (0-23) the daily cron posts the briefing. */
  briefingHour: integer("briefing_hour").notNull().default(8),
  /** Promise tracking (both directions) ships on. */
  commitmentsEnabled: boolean("commitments_enabled").notNull().default(true),
  /**
   * Opt-in: learn durable memories from every exchange (not just draft edits).
   * Off by default — it costs a model call per handled thread.
   */
  memoryAutoExtract: boolean("memory_auto_extract").notNull().default(false),
  /** 24/7 autopilot: show the overnight review block in the morning catch-up. */
  overnightReviewEnabled: boolean("overnight_review_enabled")
    .notNull()
    .default(true),
  /** When the overnight review was last composed (cron throttle). */
  overnightReviewLastAt: timestamp("overnight_review_last_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type WritingStyleProfile = {
  typicalLength: string;
  formality: string;
  commonGreeting: string;
  notableTraits: string[];
  examples: string[];
};

export const REPLY_MEMORY_KINDS = ["FACT", "PREFERENCE", "PROCEDURE"] as const;
export const REPLY_MEMORY_SCOPES = ["GLOBAL", "SENDER", "DOMAIN", "TOPIC"] as const;

export type ReplyMemoryKind = (typeof REPLY_MEMORY_KINDS)[number];
export type ReplyMemoryScope = (typeof REPLY_MEMORY_SCOPES)[number];

/**
 * A durable preference/fact/procedure learned from how the user edited an AI
 * draft. Never one-off logistics — see the durability rules in the extractor.
 * Always user-visible and deletable; provenance links back to the source draft.
 */
export const replyMemories = pgTable(
  "reply_memories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ReplyMemoryKind>().notNull(),
    scopeType: text("scope_type").$type<ReplyMemoryScope>().notNull(),
    /** Scope target: sender email, domain, or short topic; "" for GLOBAL. */
    scopeValue: text("scope_value").notNull().default(""),
    content: text("content").notNull(),
    sourceDraftId: text("source_draft_id").references(() => drafts.id, {
      onDelete: "set null",
    }),
    sourceThreadId: text("source_thread_id").references(() => threads.id, {
      onDelete: "set null",
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("reply_memories_user_scope_idx").on(t.userId, t.scopeType, t.scopeValue),
    index("reply_memories_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/** A user-authored fact the assistant should use when drafting. */
export const knowledgeEntries = pgTable(
  "knowledge_entries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("knowledge_entries_user_title_unique").on(t.userId, t.title),
    index("knowledge_entries_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/** A reusable reply fragment expanded from `{{snippet:shortcut}}`. */
export const snippets = pgTable(
  "snippets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    shortcut: text("shortcut").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("snippets_user_shortcut_unique").on(t.userId, t.shortcut),
    index("snippets_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Phase 2 — inbox intelligence                                               */
/* -------------------------------------------------------------------------- */

/**
 * The sender taxonomy. A closed set so a classification can never invent a
 * category (and so the UI has stable labels). `Cold Outreach` is the one the
 * cold-email blocker cares about; the bulk categories feed noise archiving.
 */
export const SENDER_CATEGORIES = [
  "Personal",
  "Work",
  "Financial",
  "Receipts",
  "Newsletters",
  "Marketing",
  "Notifications",
  "Cold Outreach",
  "Other",
] as const;

export type SenderCategory = (typeof SENDER_CATEGORIES)[number];

/** Categories that are safe to auto-archive when the user opts in. */
export const NOISE_CATEGORIES: SenderCategory[] = ["Newsletters", "Marketing"];

/** "active" (normal) | "allowed" (user whitelisted) | "blocked". */
export type SenderProfileStatus = "active" | "allowed" | "blocked";

/**
 * What we know about one sender address. Populated deterministically from
 * headers first, then enriched by at most one cheap model call *per new
 * sender*. Cached forever after; re-categorization is opt-in.
 */
export const senderProfiles = pgTable(
  "sender_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Lowercased address. */
    email: text("email").notNull(),
    domain: text("domain").notNull().default(""),
    category: text("category").$type<SenderCategory>().notNull().default("Other"),
    /** Category confidence 0–100. */
    confidence: integer("confidence").notNull().default(0),
    /** Probability the sender is cold outreach, 0–100 (≥70 ⇒ cold). */
    coldEmailScore: integer("cold_email_score").notNull().default(0),
    /** Probability the sender is bulk marketing, 0–100. */
    marketingScore: integer("marketing_score").notNull().default(0),
    unsubscribeUrl: text("unsubscribe_url"),
    /** "one-click" | "mailto" | null. */
    unsubscribeMethod: text("unsubscribe_method"),
    status: text("status").$type<SenderProfileStatus>().notNull().default("active"),
    /** Whether a model (not just heuristics) produced this profile. */
    modelEnriched: boolean("model_enriched").notNull().default(false),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("sender_profiles_user_email_unique").on(t.userId, t.email),
    index("sender_profiles_user_domain_idx").on(t.userId, t.domain),
    index("sender_profiles_user_category_idx").on(t.userId, t.category),
  ],
);

/**
 * A generic, user-scoped cache for computed AI artifacts (thread summaries,
 * meeting briefs, sender categories, …). One table rather than one per artifact:
 * the shape is homogeneous and every read is `(userId, type, key)`, so it stays
 * a single index. Never cached on a page render — written at compute time only.
 */
export const aiCache = pgTable(
  "ai_cache",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Artifact namespace, e.g. "thread-summary". */
    cacheType: text("cache_type").notNull(),
    /** Content hash / natural key within the type. */
    cacheKey: text("cache_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("ai_cache_user_type_key_unique").on(
      t.userId,
      t.cacheType,
      t.cacheKey,
    ),
    index("ai_cache_expiry_idx").on(t.expiresAt),
  ],
);

/** Audit trail of every unsubscribe we attempted, for idempotency + trust. */
export const unsubscribeAttempts = pgTable(
  "unsubscribe_attempts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    senderEmail: text("sender_email").notNull(),
    /** "one-click" | "mailto" | "none". */
    method: text("method").notNull(),
    /** "succeeded" | "queued" | "failed" | "no-mechanism". */
    status: text("status").notNull(),
    messageId: text("message_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("unsubscribe_attempts_user_sender_idx").on(t.userId, t.senderEmail),
    index("unsubscribe_attempts_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Phase 3 — plain-English automation rules                                   */
/* -------------------------------------------------------------------------- */

/** The v1 action set: only things the existing engine/mail client can do. */
export const RULE_ACTION_TYPES = [
  "LABEL",
  "ARCHIVE",
  "MARK_READ",
  "STAR",
  "MARK_SPAM",
  "MOVE_FOLDER",
  "DRAFT_REPLY",
  "FORWARD",
  "SEND",
  "NOTIFY",
  "ADD_TO_DIGEST",
] as const;

export type RuleActionType = (typeof RULE_ACTION_TYPES)[number];

/** Reversible actions the engine applies directly (no confirmation needed). */
export const SAFE_RULE_ACTIONS: RuleActionType[] = [
  "LABEL",
  "ARCHIVE",
  "MARK_READ",
  "STAR",
  "MARK_SPAM",
  "MOVE_FOLDER",
];

/** Actions that only shape a draft; `egress` remains the single send gate. */
export const DRAFT_RULE_ACTIONS: RuleActionType[] = ["DRAFT_REPLY", "SEND"];

export type RuleAction = {
  type: RuleActionType;
  /** Action-specific fields; only the relevant keys are ever set. */
  fields: {
    label?: string;
    folder?: string;
    instruction?: string;
    to?: string;
    message?: string;
    digest?: string;
  };
  delayMinutes?: number;
};

export type RuleCondition = {
  logic: "AND" | "OR";
  /** A semantic condition evaluated by the `fast` model, or null. */
  ai: string | null;
  from: string | null;
  to: string | null;
  subject: string | null;
  /** Sender categories (Phase 2) or triage categories to match. */
  categories: string[];
  /** Learned/simple boolean guards. */
  hasUnsubscribe?: boolean;
  coldEmail?: boolean;
};

export type RuleSource = "user" | "ai" | "learned";

export const automationRules = pgTable(
  "automation_rules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The user's original English instruction (provenance for AI rules). */
    instruction: text("instruction"),
    enabled: boolean("enabled").notNull().default(true),
    /** Lower runs first. */
    priority: integer("priority").notNull().default(100),
    condition: jsonb("condition").$type<RuleCondition>().notNull(),
    actions: jsonb("actions").$type<RuleAction[]>().notNull().default([]),
    source: text("source").$type<RuleSource>().notNull().default("user"),
    /** Compiler version that produced this rule (attribution). */
    version: text("version"),
    createdBy: text("created_by").notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("automation_rules_user_enabled_idx").on(t.userId, t.enabled, t.priority),
  ],
);

/** One rule's evaluation of one thread — the "why was this handled this way?". */
export const ruleExecutions = pgTable(
  "rule_executions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ruleId: text("rule_id")
      .notNull()
      .references(() => automationRules.id, { onDelete: "cascade" }),
    threadId: text("thread_id").references(() => threads.id, {
      onDelete: "cascade",
    }),
    messageId: text("message_id"),
    /** "matched" | "applied" | "skipped" | "error". */
    status: text("status").notNull().default("matched"),
    /** Human-readable reason shown in the rules history. */
    reason: text("reason"),
    matchMetadata: jsonb("match_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("rule_executions_user_created_idx").on(t.userId, t.createdAt),
    index("rule_executions_rule_created_idx").on(t.ruleId, t.createdAt),
    index("rule_executions_thread_idx").on(t.threadId),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Phase 4 — digests (communication superpowers)                              */
/* -------------------------------------------------------------------------- */

export const DIGEST_GROUPS = ["needs_you", "waiting", "handled", "noise"] as const;
export type DigestGroup = (typeof DIGEST_GROUPS)[number];

/**
 * One generated inbox digest. The narrative summary is stored alongside the
 * deterministic per-thread items, so the panel renders without a model and the
 * counts always match the inbox view.
 */
export const digests = pgTable(
  "digests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** "daily" | "weekly". */
    kind: text("kind").notNull().default("daily"),
    /** "ready" | "emailed" | "failed". */
    status: text("status").notNull().default("ready"),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    /** One-paragraph narrative ("what needs you this week"). */
    headline: text("headline"),
    summary: text("summary"),
    /** "model" | "heuristic" — whether a model produced the narrative. */
    source: text("source").notNull().default("heuristic"),
    threadCount: integer("thread_count").notNull().default(0),
    noiseCount: integer("noise_count").notNull().default(0),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("digests_user_generated_idx").on(t.userId, t.generatedAt),
  ],
);

/** One thread's line in a digest, with its deterministic group. */
export const digestItems = pgTable(
  "digest_items",
  {
    id: text("id").primaryKey(),
    digestId: text("digest_id")
      .notNull()
      .references(() => digests.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    threadId: text("thread_id").references(() => threads.id, {
      onDelete: "set null",
    }),
    group: text("group").$type<DigestGroup>().notNull(),
    title: text("title").notNull(),
    snippet: text("snippet"),
    reason: text("reason"),
    priority: integer("priority").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("digest_items_digest_idx").on(t.digestId),
    index("digest_items_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Phase 6 — assets (images & files)                                          */
/* -------------------------------------------------------------------------- */

export const ASSET_KINDS = ["image", "file"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/**
 * Malware-scan verdict for an asset. `pending` exists for an async scanner;
 * the inline pipeline resolves to one of the terminal states before the row is
 * visible. `skipped` means scanning was disabled by configuration.
 */
export const ASSET_SCAN_STATUSES = [
  "pending",
  "clean",
  "infected",
  "error",
  "skipped",
] as const;
export type AssetScanStatus = (typeof ASSET_SCAN_STATUSES)[number];

/** Status of the optional encrypted text-extraction pass for an asset. */
export const ASSET_EXTRACTION_STATUSES = [
  "ok",
  "unsupported",
  "failed",
  "skipped",
] as const;
export type AssetExtractionStatus = (typeof ASSET_EXTRACTION_STATUSES)[number];

/**
 * A user-owned image or file, content-addressed under a per-user prefix so
 * identical uploads dedupe. Bytes live in object storage (`lib/assets/storage`);
 * this row is the metadata + ownership record. Soft-delete only: already-sent
 * mail carries its own copy of the bytes (copied into the MIME message at send
 * time), so deleting an asset can never break a delivered message.
 */
export const assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<AssetKind>().notNull().default("file"),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    width: integer("width"),
    height: integer("height"),
    /** Storage driver key, e.g. `assets/<userId>/<sha256>`. */
    storageKey: text("storage_key").notNull(),
    /** Content hash; identical bytes never store twice for a user. */
    sha256: text("sha256").notNull(),
    altText: text("alt_text"),
    /** Malware-scan verdict. `enforce` mode refuses to attach a non-clean asset. */
    scanStatus: text("scan_status")
      .$type<AssetScanStatus>()
      .notNull()
      .default("skipped"),
    /** Scanner signature name when the verdict is `infected`. */
    scanSignature: text("scan_signature"),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("assets_user_sha_unique").on(t.userId, t.sha256),
    index("assets_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/**
 * Where an asset is referenced (a draft, rule, or campaign template). Best-effort
 * bookkeeping for safe cleanup; not required for sending.
 */
export const assetUsages = pgTable(
  "asset_usages",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    /** "draft" | "rule" | "campaign" | "template". */
    context: text("context").notNull(),
    referenceId: text("reference_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("asset_usages_asset_idx").on(t.assetId),
    index("asset_usages_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/**
 * Encrypted extracted text for an asset (Phase 6 hardening). The plaintext is
 * never stored: `ciphertext`/`iv`/`tag` are AES-256-GCM outputs sealed with a
 * key held only in the server environment. One row per asset (unique), so a
 * re-run replaces rather than duplicates. Owned by the user and cascade-deleted
 * with the asset.
 */
export const assetExtractions = pgTable(
  "asset_extractions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    status: text("status").$type<AssetExtractionStatus>().notNull(),
    /** Extractor that produced the text, e.g. "text/plain" | "text/html". */
    parser: text("parser"),
    /** Base64 AES-256-GCM ciphertext of the extracted text. */
    ciphertext: text("ciphertext"),
    iv: text("iv"),
    tag: text("tag"),
    charCount: integer("char_count").notNull().default(0),
    truncated: boolean("truncated").notNull().default(false),
    /** Content-free failure marker; never the raw error or any file bytes. */
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("asset_extractions_asset_unique").on(t.assetId),
    index("asset_extractions_user_idx").on(t.userId),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Phase 7 — bulk outreach (mail merge + reply automation)                    */
/* -------------------------------------------------------------------------- */

export const CAMPAIGN_STATUSES = [
  "draft",
  "scheduled",
  "sending",
  "paused",
  "done",
  "cancelled",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_RECIPIENT_STATUSES = [
  "pending",
  "sending",
  "sent",
  "failed",
  "skipped",
  "replied",
  "unsubscribed",
  "bounced",
] as const;
export type CampaignRecipientStatus = (typeof CAMPAIGN_RECIPIENT_STATUSES)[number];

/** `{{name}}`-style merge fields plus `{{AI: …}}` prompt blocks. */
export type CampaignTemplate = {
  subject: string;
  body: string;
  /** Asset ids rendered inline under the merged body. */
  inlineImageIds?: string[];
  /** Asset ids attached to every message. */
  attachmentIds?: string[];
};

export type CampaignSendWindow = {
  /** Local hour the window opens (0-23). */
  startHour: number;
  /** Local hour the window closes (0-23). */
  endHour: number;
  timeZone: string;
};

export const bulkCampaigns = pgTable(
  "bulk_campaigns",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status").$type<CampaignStatus>().notNull().default("draft"),
    template: jsonb("template").$type<CampaignTemplate>().notNull(),
    senderName: text("sender_name"),
    replyTo: text("reply_to"),
    /** Recipients per hour, clamped to Gmail limits at send time. */
    throttlePerHour: integer("throttle_per_hour").notNull().default(50),
    sendWindow: jsonb("send_window").$type<CampaignSendWindow | null>(),
    /** "off" | "drafts" (default) | "autopilot". */
    replyPolicy: text("reply_policy").notNull().default("drafts"),
    /** Optional CAN-SPAM physical address appended to every message. */
    footerAddress: text("footer_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("bulk_campaigns_user_created_idx").on(t.userId, t.createdAt),
    index("bulk_campaigns_user_status_idx").on(t.userId, t.status),
  ],
);

export const bulkRecipients = pgTable(
  "bulk_recipients",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => bulkCampaigns.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    /** The mapped source row (for arbitrary merge fields). */
    rowData: jsonb("row_data").$type<Record<string, string>>().notNull().default({}),
    status: text("status")
      .$type<CampaignRecipientStatus>()
      .notNull()
      .default("pending"),
    gmailMessageId: text("gmail_message_id"),
    threadId: text("thread_id"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** The personalized body actually sent (post AI-block fill). */
    personalizedBody: text("personalized_body"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("bulk_recipients_campaign_email_unique").on(t.campaignId, t.email),
    index("bulk_recipients_campaign_status_idx").on(t.campaignId, t.status),
    index("bulk_recipients_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/** Append-only audit trail for a campaign (send, pause, reply, unsubscribe…). */
export const campaignEvents = pgTable(
  "campaign_events",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => bulkCampaigns.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    recipientId: text("recipient_id").references(() => bulkRecipients.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("campaign_events_campaign_created_idx").on(t.campaignId, t.createdAt),
    index("campaign_events_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export const suppressionList = pgTable(
  "suppression_list",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    /** "unsubscribe" | "bounce" | "manual" | "existing_contact" | "complaint". */
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("suppression_list_user_email_unique").on(t.userId, t.email),
    index("suppression_list_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export const schema = {
  user,
  session,
  account,
  verification,
  onboardingState,
  agentChatThread,
  agentChatMessage,
  agentRuns,
  pendingActions,
  scheduledActions,
  researchCache,
  mailboxes,
  threads,
  messages,
  contacts,
  threadStates,
  calendarSettings,
  eventLog,
  sendLedger,
  jobQueue,
  flows,
  flowRuns,
  flowCheckpoints,
  meetings,
  followupSequences,
  followupEnrollments,
  commitments,
  threadSettings,
  drafts,
  autopilotPolicies,
  autopilotDecisions,
  aiUsageEvents,
  assistantSettings,
  replyMemories,
  knowledgeEntries,
  snippets,
  senderProfiles,
  aiCache,
  unsubscribeAttempts,
  automationRules,
  ruleExecutions,
  digests,
  digestItems,
  assets,
  assetUsages,
  bulkCampaigns,
  bulkRecipients,
  campaignEvents,
  suppressionList,
};
