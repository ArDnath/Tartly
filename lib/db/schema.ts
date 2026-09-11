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
    // Archive marker (Twenty uses `deletedAt` for the same purpose).
    archivedAt: timestamp("archived_at"),
    lastMessageAt: timestamp("last_message_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  // The sidebar lists a user's threads newest-first; Postgres does not index
  // FK columns automatically.
  (t) => [index("agent_chat_thread_user_updated_idx").on(t.userId, t.updatedAt)],
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
export type ChatMessagePart =
  | ChatTextPart
  | ChatReasoningPart
  | ChatToolPart;

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
  priority: integer("priority").notNull().default(0),
  action: text("action").notNull(),
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
    /** "pending" | "sent" | "discarded". */
    status: text("status").notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("drafts_thread_status_idx").on(t.threadId, t.status),
    index("drafts_user_status_idx").on(t.userId, t.status),
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
  drafts,
};
