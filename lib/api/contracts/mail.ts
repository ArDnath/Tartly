import { z } from "zod";

import { defineOperation } from "./registry";
import {
  COMPOSE_ASSIST_ACTIONS,
  createdResponse,
  dataEnvelope,
  okResponse,
  streamResponse,
} from "./shared";

/**
 * Gmail-backed mail routes (Phase C1). All require a connected Google account;
 * `withMailUser` maps a revoked grant to `403 gmail_not_connected`.
 */

export const mailAssistBody = z.object({
  action: z.enum(COMPOSE_ASSIST_ACTIONS),
  body: z.string().max(20_000),
  selection: z.string().max(8_000).optional(),
  subject: z.string().max(500).optional(),
  to: z.array(z.string().max(320)).max(20).optional(),
  targetLanguage: z.string().max(40).optional(),
  instruction: z.string().max(2_000).optional(),
});

export const mailDraftBody = z.object({
  to: z.array(z.string()).optional(),
  subject: z.string().optional(),
  instruction: z.string().optional(),
});

export const mailCreateDraftBody = z.object({
  to: z.array(z.string().min(1)).default([]),
  cc: z.array(z.string().min(1)).optional(),
  bcc: z.array(z.string().min(1)).optional(),
  subject: z.string().default(""),
  body: z.string().default(""),
  threadId: z.string().optional(),
  inReplyTo: z.string().optional(),
});

export const mailComposeAgentBody = z.object({
  /** The user's free-form instruction, sent as the agent turn. */
  text: z.string().min(1).max(8_000),
  /** Whatever the composer already holds, as context for the agent. */
  compose: z
    .object({
      to: z.array(z.string().max(320)).max(20).optional(),
      cc: z.array(z.string().max(320)).max(20).optional(),
      bcc: z.array(z.string().max(320)).max(20).optional(),
      subject: z.string().max(500).optional(),
      body: z.string().max(20_000).optional(),
    })
    .optional(),
});

export const mailSendBody = z.object({
  to: z.array(z.string().min(1)).min(1),
  cc: z.array(z.string().min(1)).optional(),
  bcc: z.array(z.string().min(1)).optional(),
  subject: z.string().default(""),
  body: z.string().default(""),
  threadId: z.string().optional(),
  inReplyTo: z.string().optional(),
  assetIds: z.array(z.string()).max(20).optional(),
  inlineImageIds: z.array(z.string()).max(20).optional(),
});

export const mailLabelBody = z.object({ label: z.string().trim().min(1) });

export const mailMessagesQuery = z
  .object({
    box: z.string().optional().describe("Defaults to `inbox`."),
    search: z.string().optional(),
    limit: z.string().optional().describe("Clamped to 100; default 30."),
    pageToken: z.string().optional(),
  })
  .passthrough();

export const mailEventsQuery = z
  .object({ since: z.string().optional() })
  .passthrough();

export const mailTranslateBody = z.object({
  text: z.string().min(1).max(20_000),
  targetLanguage: z.string().min(1).max(40),
});

export const mailUnsubscribeBody = z.object({
  senderEmail: z.string().min(3).max(320),
  threadId: z.string().min(1).max(200).optional(),
  archiveThread: z.boolean().optional(),
});

const batchIds = z.array(z.string().min(1)).min(1);

export const mailArchiveBody = z.object({ ids: batchIds, archived: z.boolean() });
export const mailReadBody = z.object({ ids: batchIds, read: z.boolean() });
export const mailSpamBody = z.object({ ids: batchIds, spam: z.boolean() });
export const mailStarBody = z.object({ ids: batchIds, starred: z.boolean() });
export const mailTrashBody = z.object({ ids: batchIds, trashed: z.boolean() });

export const mailLabelMessagesBody = z.object({
  ids: z.array(z.string().min(1)).min(1),
  label: z.string().trim().min(1),
});

const updatedSchema = dataEnvelope(z.object({ updated: z.number().int() }));

function batchOperation(
  segment: string,
  summary: string,
  body: z.ZodType,
) {
  return defineOperation({
    method: "POST",
    path: `/api/v1/mail/messages/${segment}`,
    operationId: `mailMessages${segment[0]!.toUpperCase()}${segment.slice(1)}`,
    tags: ["mail"],
    summary,
    security: "session",
    body,
    responses: okResponse(updatedSchema),
  });
}

export const mailOperations = [
  defineOperation({
    method: "POST",
    path: "/api/v1/mail/assist",
    operationId: "mailAssist",
    tags: ["mail"],
    summary: "Stream a compose suggestion",
    security: "session",
    body: mailAssistBody,
    responses: streamResponse("text/plain", "Raw suggested text stream."),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/mail/draft",
    operationId: "mailDraftWithAi",
    tags: ["mail"],
    summary: "Draft an email body with AI (never sends)",
    security: "session",
    body: mailDraftBody,
    responses: okResponse(
      dataEnvelope(
        z.object({ body: z.string(), source: z.enum(["ai", "fallback"]) }),
      ),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/mail/compose",
    operationId: "composeMailWithAgent",
    tags: ["mail"],
    summary: "Stream the compose agent (never sends)",
    security: "session",
    body: mailComposeAgentBody,
    responses: streamResponse(
      "text/event-stream",
      "AI SDK UI message stream; the `deliver_composer_draft` tool result carries the draft.",
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/mail/drafts",
    operationId: "createMailDraft",
    tags: ["mail"],
    summary: "Save a Gmail draft",
    security: "session",
    body: mailCreateDraftBody,
    responses: createdResponse(dataEnvelope(z.object({ id: z.string() }))),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/mail/events",
    operationId: "streamMailEvents",
    tags: ["mail"],
    summary: "Server-sent mail updates",
    security: "session",
    query: mailEventsQuery,
    responses: streamResponse(
      "text/event-stream",
      "`mail.updated` / `ping` / `reconnect` events.",
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/mail/labels",
    operationId: "createMailLabel",
    tags: ["mail"],
    summary: "Create a Gmail label",
    security: "session",
    body: mailLabelBody,
    responses: createdResponse(dataEnvelope(z.object({ label: z.string() }))),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/mail/messages",
    operationId: "listMailMessages",
    tags: ["mail"],
    summary: "List Gmail messages (page-token paginated)",
    security: "session",
    query: mailMessagesQuery,
    responses: okResponse(
      dataEnvelope(
        z.object({
          messages: z.array(z.unknown()),
          nextPageToken: z.string().optional(),
          labels: z.array(z.string()),
        }),
      ),
    ),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/mail/messages/{id}",
    operationId: "getMailMessage",
    tags: ["mail"],
    summary: "Get a full Gmail message",
    security: "session",
    responses: okResponse(dataEnvelope(z.unknown())),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/mail/threads/{id}",
    operationId: "getMailThread",
    tags: ["mail"],
    summary: "Get a full Gmail conversation",
    security: "session",
    responses: okResponse(dataEnvelope(z.unknown())),
  }),
  batchOperation("archive", "Archive or unarchive messages", mailArchiveBody),
  batchOperation("read", "Mark messages read or unread", mailReadBody),
  batchOperation("spam", "Mark messages as spam or not", mailSpamBody),
  batchOperation("star", "Star or unstar messages", mailStarBody),
  batchOperation("trash", "Trash or untrash messages", mailTrashBody),
  batchOperation(
    "label",
    "Apply a label to messages",
    mailLabelMessagesBody,
  ),
  defineOperation({
    method: "GET",
    path: "/api/v1/mail/profile",
    operationId: "getMailProfile",
    tags: ["mail"],
    summary: "Gmail profile (address + total)",
    security: "session",
    responses: okResponse(
      dataEnvelope(
        z.object({ emailAddress: z.string(), messagesTotal: z.number().int() }),
      ),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/mail/send",
    operationId: "sendMail",
    tags: ["mail"],
    summary: "Send an email (idempotent)",
    security: "session",
    body: mailSendBody,
    responses: okResponse(
      dataEnvelope(z.object({ id: z.string(), threadId: z.string() })),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/mail/translate",
    operationId: "translateMail",
    tags: ["mail"],
    summary: "Translate text",
    security: "session",
    body: mailTranslateBody,
    responses: okResponse(
      dataEnvelope(
        z.object({
          text: z.string(),
          source: z.enum(["model", "fallback"]),
          targetLanguage: z.string(),
        }),
      ),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/mail/unsubscribe",
    operationId: "unsubscribeSender",
    tags: ["mail"],
    summary: "Unsubscribe from a sender",
    security: "session",
    body: mailUnsubscribeBody,
    responses: okResponse(
      dataEnvelope(
        z.object({
          method: z.string(),
          status: z.enum(["succeeded", "queued", "failed", "no-mechanism"]),
          target: z.string().nullable(),
          archived: z.number().int(),
          note: z.string(),
        }),
      ),
    ),
  }),
] as const;
