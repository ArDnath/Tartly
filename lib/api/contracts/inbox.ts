import { z } from "zod";

import { defineOperation } from "./registry";
import {
  cursorQuery,
  dataEnvelope,
  okResponse,
  pageEnvelope,
} from "./shared";

/**
 * Inbox, follow-ups, runs, commitments, briefing, metrics, activity and
 * per-thread autonomy (Phase C1).
 */

export const inboxQuery = z
  .object({
    // Unknown views fall back to `needs_reply` in the handler; keep the
    // contract permissive rather than 400-ing a value the server accepts.
    view: z.string().optional().describe("Inbox bucket; defaults to needs_reply."),
    since: z.string().optional(),
    cursor: z
      .string()
      .optional()
      .describe("Opaque keyset cursor returned as `pagination.next_cursor`."),
    limit: z
      .string()
      .optional()
      .describe("Page size; default 50, clamped to a maximum of 100."),
  })
  .passthrough();

export const digestBody = z
  .object({ kind: z.string().optional() })
  .passthrough()
  .describe("Omit or send {} for a daily digest; kind only reads `weekly`.");

export const followupSnoozeBody = z.object({
  days: z.number().int().min(1).max(30).default(1),
});

export const followupPauseBody = z.object({ paused: z.boolean() });

export const threadAutonomyBody = z.object({
  autonomy: z.enum(["copilot", "autopilot"]).nullable(),
});

const runSchema = z.object({
  id: z.string(),
  status: z.string(),
  triggerKind: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const inboxOperations = [
  defineOperation({
    method: "GET",
    path: "/api/v1/inbox",
    operationId: "getInbox",
    tags: ["inbox"],
    summary: "List the inbox (cursor-paginated, by view)",
    security: "session",
    query: inboxQuery,
    responses: okResponse(
      pageEnvelope(
        z.object({ view: z.string(), items: z.array(z.unknown()) }),
      ),
      "A page of inbox threads for the requested view.",
    ),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/inbox/digest",
    operationId: "getInboxDigest",
    tags: ["inbox"],
    summary: "Read the latest stored digest (never generates)",
    security: "session",
    responses: okResponse(
      dataEnvelope(z.object({ digest: z.unknown(), enabled: z.boolean() })),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/inbox/digest",
    operationId: "generateInboxDigest",
    tags: ["inbox"],
    summary: "Generate a digest",
    security: "session",
    body: digestBody,
    responses: okResponse(dataEnvelope(z.object({ digest: z.unknown() }))),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/inbox/sync",
    operationId: "syncInbox",
    tags: ["inbox"],
    summary: "Enqueue a mailbox sync",
    security: "session",
    responses: okResponse(
      dataEnvelope(
        z.object({ accepted: z.literal(true), mailboxId: z.string() }),
      ),
    ),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/inbox/{threadId}",
    operationId: "getInboxThread",
    tags: ["inbox"],
    summary: "Thread detail (state, history, draft, proposal, meeting)",
    security: "session",
    responses: okResponse(dataEnvelope(z.unknown())),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/inbox/{threadId}/summary",
    operationId: "getThreadSummary",
    tags: ["inbox"],
    summary: "Read the cached thread summary",
    security: "session",
    responses: okResponse(
      dataEnvelope(
        z.object({
          summary: z.unknown(),
          canSummarize: z.boolean(),
          enabled: z.boolean(),
        }),
      ),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/inbox/{threadId}/summary",
    operationId: "generateThreadSummary",
    tags: ["inbox"],
    summary: "Generate and cache a thread summary",
    security: "session",
    responses: okResponse(dataEnvelope(z.object({ summary: z.unknown() }))),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/inbox/{threadId}/draft",
    operationId: "regenerateThreadDraft",
    tags: ["inbox"],
    summary: "Regenerate the reply draft for a thread",
    security: "session",
    responses: okResponse(
      dataEnvelope(z.object({ draftId: z.string(), body: z.string() })),
    ),
  }),

  defineOperation({
    method: "GET",
    path: "/api/v1/followups",
    operationId: "listFollowups",
    tags: ["followups"],
    summary: "List follow-up enrollments (cursor-paginated)",
    security: "session",
    query: cursorQuery(),
    responses: okResponse(
      pageEnvelope(z.object({ followups: z.array(z.unknown()) })),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/followups/{id}/snooze",
    operationId: "snoozeFollowup",
    tags: ["followups"],
    summary: "Snooze a follow-up by N days",
    security: "session",
    body: followupSnoozeBody,
    responses: okResponse(
      dataEnvelope(
        z.object({
          id: z.string(),
          status: z.string(),
          nextEvalAt: z.unknown(),
        }),
      ),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/followups/{id}/pause",
    operationId: "pauseFollowup",
    tags: ["followups"],
    summary: "Pause or resume a follow-up",
    security: "session",
    body: followupPauseBody,
    responses: okResponse(
      dataEnvelope(z.object({ id: z.string(), status: z.string() })),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/followups/{id}/stop",
    operationId: "stopFollowup",
    tags: ["followups"],
    summary: "Stop a follow-up",
    security: "session",
    responses: okResponse(dataEnvelope(z.object({ stopped: z.literal(true) }))),
  }),

  defineOperation({
    method: "GET",
    path: "/api/v1/runs",
    operationId: "listRuns",
    tags: ["runs"],
    summary: "List flow runs (cursor-paginated)",
    security: "session",
    query: cursorQuery(),
    responses: okResponse(pageEnvelope(z.object({ runs: z.array(runSchema) }))),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/runs/{id}",
    operationId: "getRun",
    tags: ["runs"],
    summary: "Run detail (state, trace, error)",
    security: "session",
    responses: okResponse(dataEnvelope(z.unknown())),
  }),

  defineOperation({
    method: "GET",
    path: "/api/v1/commitments",
    operationId: "listCommitments",
    tags: ["commitments"],
    summary: "List commitments",
    security: "session",
    responses: okResponse(
      dataEnvelope(z.object({ commitments: z.array(z.unknown()) })),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/commitments/{id}/dismiss",
    operationId: "dismissCommitment",
    tags: ["commitments"],
    summary: "Dismiss a commitment",
    security: "session",
    responses: okResponse(
      dataEnvelope(z.object({ dismissed: z.literal(true) })),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/commitments/{id}/fulfill",
    operationId: "fulfillCommitment",
    tags: ["commitments"],
    summary: "Mark a commitment fulfilled",
    security: "session",
    responses: okResponse(
      dataEnvelope(z.object({ fulfilled: z.literal(true) })),
    ),
  }),

  defineOperation({
    method: "GET",
    path: "/api/v1/briefing",
    operationId: "getBriefing",
    tags: ["briefing"],
    summary: "Morning briefing catch-up",
    security: "session",
    responses: okResponse(dataEnvelope(z.object({ catchUp: z.unknown() }))),
  }),

  defineOperation({
    method: "GET",
    path: "/api/v1/metrics",
    operationId: "getMetrics",
    tags: ["metrics"],
    summary: "Inbox metrics for the last N days",
    security: "session",
    query: z.object({ sinceDays: z.string().optional() }).passthrough(),
    responses: okResponse(dataEnvelope(z.unknown())),
  }),

  defineOperation({
    method: "GET",
    path: "/api/v1/activity/report",
    operationId: "getActivityReport",
    tags: ["activity"],
    summary: "Read the cached activity report",
    security: "session",
    responses: okResponse(
      dataEnvelope(z.object({ report: z.unknown(), enabled: z.boolean() })),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/activity/report",
    operationId: "generateActivityReport",
    tags: ["activity"],
    summary: "Generate the activity report",
    security: "session",
    responses: okResponse(dataEnvelope(z.object({ report: z.unknown() }))),
  }),

  defineOperation({
    method: "GET",
    path: "/api/v1/threads/{threadId}/autonomy",
    operationId: "getThreadAutonomy",
    tags: ["threads"],
    summary: "Read effective autonomy for a thread",
    security: "session",
    responses: okResponse(
      dataEnvelope(
        z.object({
          autonomy: z.enum(["copilot", "autopilot"]).nullable(),
          effective: z.enum(["copilot", "autopilot"]),
          source: z.string(),
        }),
      ),
    ),
  }),
  defineOperation({
    method: "PATCH",
    path: "/api/v1/threads/{threadId}/autonomy",
    operationId: "setThreadAutonomy",
    tags: ["threads"],
    summary: "Override autonomy for a thread (`null` clears it)",
    security: "session",
    body: threadAutonomyBody,
    responses: okResponse(
      dataEnvelope(
        z.object({
          autonomy: z.enum(["copilot", "autopilot"]).nullable(),
          effective: z.enum(["copilot", "autopilot"]),
          source: z.string(),
        }),
      ),
    ),
  }),
] as const;
