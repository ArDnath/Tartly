import { z } from "zod";

import { defineOperation } from "./registry";
import {
  createdResponse,
  dataEnvelope,
  emptyResponse,
  noContentResponse,
  okResponse,
  streamResponse,
} from "./shared";

/**
 * Legacy assistant chat, onboarding, sign-out, health probes and the Gmail
 * Pub/Sub webhook (Phase C1). These are raw Next handlers (not `withUser`), so
 * runtime contract validation does not apply to them; the schemas document the
 * contract and drive the spec.
 */

export const aiAssistantBody = z.object({
  scope: z.enum(["mail", "calendar"]),
  question: z.string().min(1).max(4_000),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const aiThreadCreateBody = z
  .object({ title: z.string().max(120).optional() })
  .passthrough();

export const aiThreadPatchBody = z.object({
  title: z.string().min(1).max(120).optional(),
  archived: z.boolean().optional(),
});

export const aiThreadMessageBody = z.object({
  message: z.string().min(1).max(8_000),
});

export const aiChatBody = z.object({
  threadId: z.string().min(1),
  message: z.string().max(8_000).optional(),
});

export const onboardingCalendarBody = z.object({
  timezone: z.string().min(1).max(100),
  workDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  workStartHour: z.number().int().min(0).max(23),
  workEndHour: z.number().int().min(1).max(24),
  bufferMins: z.number().int().min(0).max(180),
  defaultDurationMins: z.number().int().min(5).max(480),
});

export const onboardingWorkspaceSetupBody = z.object({
  companyContext: z.unknown().optional(),
  personContext: z.unknown().optional(),
});

export const onboardingAdvanceBody = z.object({
  action: z.enum(["complete", "skip"]).default("complete"),
  data: z
    .object({
      firstName: z.string().min(1).max(80).optional(),
      lastName: z.string().max(80).optional(),
      jobTitle: z.string().max(120).optional(),
      image: z.string().max(1_600_000).optional(),
    })
    .default({}),
});

export const gmailWebhookBody = z
  .object({ message: z.object({ data: z.string() }).optional() })
  .passthrough();

const healthCheckSchema = z.object({
  status: z.string(),
  latencyMs: z.number().optional(),
  error: z.string().optional(),
});

export const legacyOperations = [
  defineOperation({
    method: "POST",
    path: "/api/ai/assistant",
    operationId: "aiAssistant",
    tags: ["ai"],
    summary: "Stream an assistant answer about mail/calendar",
    security: "session",
    body: aiAssistantBody,
    responses: streamResponse("text/event-stream", "SSE answer stream."),
  }),
  defineOperation({
    method: "GET",
    path: "/api/ai/threads",
    operationId: "listAiThreads",
    tags: ["ai"],
    summary: "List assistant chat threads",
    security: "session",
    query: z
      .object({ includeArchived: z.string().optional() })
      .passthrough(),
    responses: okResponse(z.object({ threads: z.array(z.unknown()) })),
  }),
  defineOperation({
    method: "POST",
    path: "/api/ai/threads",
    operationId: "createAiThread",
    tags: ["ai"],
    summary: "Create an assistant chat thread",
    security: "session",
    body: aiThreadCreateBody,
    responses: createdResponse(z.object({ thread: z.unknown() })),
  }),
  defineOperation({
    method: "PATCH",
    path: "/api/ai/threads/{threadId}",
    operationId: "updateAiThread",
    tags: ["ai"],
    summary: "Rename or archive a thread",
    security: "session",
    body: aiThreadPatchBody,
    responses: okResponse(z.object({ thread: z.unknown() })),
  }),
  defineOperation({
    method: "DELETE",
    path: "/api/ai/threads/{threadId}",
    operationId: "deleteAiThread",
    tags: ["ai"],
    summary: "Delete a thread",
    security: "session",
    responses: noContentResponse(),
  }),
  defineOperation({
    method: "GET",
    path: "/api/ai/threads/{threadId}/messages",
    operationId: "listAiThreadMessages",
    tags: ["ai"],
    summary: "List a thread's visible messages",
    security: "session",
    responses: okResponse(
      z.object({
        thread: z.unknown(),
        messages: z.array(z.unknown()),
      }),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/ai/threads/{threadId}/messages",
    operationId: "sendAiThreadMessage",
    tags: ["ai"],
    summary: "Send a message and stream the reply",
    security: "session",
    body: aiThreadMessageBody,
    responses: streamResponse("text/event-stream", "SSE reply stream."),
  }),
  defineOperation({
    method: "POST",
    path: "/api/ai/chat",
    operationId: "aiWorkspaceSetupChat",
    tags: ["ai"],
    summary: "Workspace-setup chat streaming reply",
    security: "session",
    body: aiChatBody,
    responses: streamResponse("text/event-stream", "SSE `delta`/`done` frames."),
  }),

  defineOperation({
    method: "POST",
    path: "/api/onboarding/calendar",
    operationId: "saveOnboardingCalendar",
    tags: ["onboarding"],
    summary: "Save calendar preferences during onboarding",
    security: "session",
    body: onboardingCalendarBody,
    responses: okResponse(z.object({ state: z.unknown() })),
  }),
  defineOperation({
    method: "GET",
    path: "/api/onboarding/sync-email/complete",
    operationId: "completeEmailSync",
    tags: ["onboarding"],
    summary: "OAuth landing that completes email sync",
    security: "session",
    responses: emptyResponse(307, "Redirect back into onboarding."),
  }),
  defineOperation({
    method: "POST",
    path: "/api/onboarding/workspace-setup-chat",
    operationId: "startWorkspaceSetupChat",
    tags: ["onboarding"],
    summary: "Start the deterministic workspace-setup thread",
    security: "session",
    body: onboardingWorkspaceSetupBody,
    responses: okResponse(
      z.object({
        outcome: z.enum(["STARTED", "ALREADY_STARTED", "UNAVAILABLE"]),
        thread: z.unknown().nullable(),
        messages: z.array(z.unknown()),
      }),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/onboarding/back",
    operationId: "onboardingBack",
    tags: ["onboarding"],
    summary: "Go back an onboarding step",
    security: "session",
    responses: okResponse(z.object({ state: z.unknown() })),
  }),
  defineOperation({
    method: "GET",
    path: "/api/onboarding/state",
    operationId: "getOnboardingState",
    tags: ["onboarding"],
    summary: "Read onboarding state",
    security: "session",
    responses: okResponse(z.object({ state: z.unknown() })),
  }),
  defineOperation({
    method: "POST",
    path: "/api/onboarding/advance",
    operationId: "advanceOnboarding",
    tags: ["onboarding"],
    summary: "Advance or complete an onboarding step",
    security: "session",
    body: onboardingAdvanceBody,
    responses: okResponse(
      z.object({ state: z.unknown(), justCompleted: z.boolean() }),
    ),
  }),

  defineOperation({
    method: "POST",
    path: "/api/sign-out",
    operationId: "signOut",
    tags: ["auth"],
    summary: "Clear the session cookies",
    security: "public",
    responses: okResponse(z.object({ success: z.literal(true) })),
  }),

  defineOperation({
    method: "GET",
    path: "/api/health/live",
    operationId: "healthLive",
    tags: ["health"],
    summary: "Liveness probe (process only)",
    security: "public",
    responses: okResponse(
      z.object({ status: z.string(), checks: z.record(z.string(), z.unknown()) }),
    ),
  }),
  defineOperation({
    method: "GET",
    path: "/api/health/ready",
    operationId: "healthReady",
    tags: ["health"],
    summary: "Readiness probe (Postgres + Redis)",
    security: "public",
    responses: {
      200: {
        description: "All dependencies reachable.",
        schema: z.object({
          status: z.string(),
          checks: z.record(z.string(), healthCheckSchema),
        }),
      },
      530: {
        description: "One or more dependencies unavailable.",
        schema: z.object({
          status: z.string(),
          checks: z.record(z.string(), healthCheckSchema),
        }),
      },
    },
  }),

  defineOperation({
    method: "POST",
    path: "/api/webhooks/gmail",
    operationId: "gmailPubSubWebhook",
    tags: ["webhooks"],
    summary: "Google Pub/Sub push for Gmail watch notifications",
    security: "webhook",
    body: gmailWebhookBody,
    responses: okResponse(
      dataEnvelope(
        z
          .object({
            ignored: z.literal(true),
            accepted: z.literal(true),
            deduped: z.boolean(),
          })
          .partial(),
      ),
    ),
  }),

  defineOperation({
    method: "POST",
    path: "/api/csp-report",
    operationId: "cspReport",
    tags: ["security"],
    summary: "Receive CSP violation reports during report-only burn-in",
    security: "public",
    responses: noContentResponse(),
  }),
] as const;
