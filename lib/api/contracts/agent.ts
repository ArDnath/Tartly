import { z } from "zod";

import { defineOperation } from "./registry";
import {
  cursorQuery,
  dataEnvelope,
  okResponse,
  pageEnvelope,
  streamResponse,
  PENDING_ACTION_STATUSES,
} from "./shared";

/**
 * Agent chat/actions/conversations/events and the two draft lifecycle routes
 * (Phase C1).
 */

export const confirmActionBody = z.object({
  /** Optional restatement of the frozen args; must hash to the stored value. */
  args: z.record(z.string(), z.unknown()).optional(),
});

export const agentChatBody = z
  .object({
    conversationId: z.string().min(1).max(64),
    text: z.string().max(8_000).optional(),
    resumeActionId: z.string().min(1).max(64).optional(),
    currentThreadId: z.string().max(256).optional(),
    currentEmailId: z.string().max(256).optional(),
  })
  .refine((value) => Boolean(value.resumeActionId || value.text?.trim()), {
    message: "A message or a resumeActionId is required.",
    path: ["text"],
  });

export const conversationParams = z.object({
  conversationId: z.string().min(1).max(64),
});

export const agentEventsQuery = z
  .object({ since: z.string().optional() })
  .passthrough();

export const approveDraftBody = z.object({
  editedBody: z.string().max(20_000).optional(),
});

export const agentOperations = [
  defineOperation({
    method: "GET",
    path: "/api/v1/agent/actions",
    operationId: "listAgentActions",
    tags: ["agent"],
    summary: "List pending actions (cursor-paginated)",
    security: "session",
    query: cursorQuery({
      status: z.enum(PENDING_ACTION_STATUSES).optional(),
    }),
    responses: okResponse(
      pageEnvelope(z.object({ actions: z.array(z.unknown()) })),
    ),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/agent/actions/{id}",
    operationId: "getAgentAction",
    tags: ["agent"],
    summary: "Get one pending action",
    security: "session",
    responses: okResponse(dataEnvelope(z.object({ action: z.unknown() }))),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/agent/actions/{id}/confirm",
    operationId: "confirmAgentAction",
    tags: ["agent"],
    summary: "Confirm and execute a pending action",
    security: "session",
    body: confirmActionBody,
    responses: okResponse(
      dataEnvelope(
        z.object({
          action: z.unknown(),
          result: z.unknown(),
          executed: z.boolean(),
        }),
      ),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/agent/actions/{id}/cancel",
    operationId: "cancelAgentAction",
    tags: ["agent"],
    summary: "Cancel a pending action",
    security: "session",
    responses: okResponse(dataEnvelope(z.object({ action: z.unknown() }))),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/agent/chat",
    operationId: "agentChat",
    tags: ["agent"],
    summary: "Stream a turn of the agent conversation",
    security: "session",
    body: agentChatBody,
    responses: streamResponse(
      "text/event-stream",
      "AI SDK UI message stream (header `X-Agent-Run-Id`).",
    ),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/agent/conversations/{conversationId}",
    operationId: "getAgentConversation",
    tags: ["agent"],
    summary: "Load a conversation and its messages",
    security: "session",
    params: conversationParams,
    responses: okResponse(
      dataEnvelope(
        z.object({
          conversation: z.unknown(),
          messages: z.array(z.unknown()),
        }),
      ),
    ),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/agent/events",
    operationId: "streamAgentEvents",
    tags: ["agent"],
    summary: "Server-sent action updates",
    security: "session",
    query: agentEventsQuery,
    responses: streamResponse(
      "text/event-stream",
      "`action.updated` / `ping` events; reconnect after ~5 minutes.",
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/drafts/{id}/approve",
    operationId: "approveDraft",
    tags: ["drafts"],
    summary: "Approve and send a draft",
    security: "session",
    body: approveDraftBody,
    responses: okResponse(
      dataEnvelope(z.object({ sent: z.boolean(), deduped: z.boolean() })),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/drafts/{id}/discard",
    operationId: "discardDraft",
    tags: ["drafts"],
    summary: "Discard a draft",
    security: "session",
    responses: okResponse(
      dataEnvelope(z.object({ discarded: z.literal(true) })),
    ),
  }),
] as const;
