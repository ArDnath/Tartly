import { z } from "zod";

import type { ResponseSpec } from "./registry";

/**
 * Cross-cutting contract schemas and tiny response builders shared by the
 * operation modules (Phase C1).
 *
 * Keep these in lock-step with the runtime envelopes in `lib/api/http.ts` and
 * `lib/api/error-envelope.ts`. The `*_VALUES` constants mirror the domain
 * enums in code but are duplicated here deliberately: importing
 * `lib/db/schema.ts` (or the feature modules that own them) into every route
 * would drag the ORM/prompt graph into the request path.
 */

/** `{ error: { code, message, trace_id, details? } }` (SKILL §5.1). */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    trace_id: z.string(),
    details: z.unknown().optional(),
  }),
});

/** Cursor pagination sibling of `data` (SKILL §2.4). */
export const paginationSchema = z.object({
  limit: z.number().int(),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});

/** Standard success envelope: `{ data }`. */
export function dataEnvelope<T extends z.ZodType>(data: T) {
  return z.object({ data });
}

/** Paginated success envelope: `{ data, pagination }`. */
export function pageEnvelope<T extends z.ZodType>(data: T) {
  return z.object({ data, pagination: paginationSchema });
}

/** Generic JSON body for request bodies that are documented but not typed. */
export const jsonObjectSchema = z.record(z.string(), z.unknown());

/** Path-param object for a single `{id}`-style segment. */
export function singleParam(name: string) {
  return z.object({ [name]: z.string().min(1) });
}

/**
 * Cursor + limit query, deliberately permissive: the handlers clamp/ignore
 * invalid `limit` values rather than rejecting, so the contract must not turn a
 * previously-accepted request into a `400`.
 */
export function cursorQuery(extra: z.ZodRawShape = {}) {
  return z
    .object({
      cursor: z
        .string()
        .optional()
        .describe("Opaque keyset cursor returned as `pagination.next_cursor`."),
      limit: z
        .string()
        .optional()
        .describe("Page size; default 50, clamped to a maximum of 100."),
      ...extra,
    })
    .passthrough();
}

/** Generic query object for routes that read a few ad-hoc params. */
export function looseQuery(extra: z.ZodRawShape = {}) {
  return z.object(extra).passthrough();
}

function response(
  status: number,
  description: string,
  schema?: z.ZodType,
): Record<number, ResponseSpec> {
  return { [status]: schema ? { description, schema } : { description } };
}

export function okResponse(
  schema?: z.ZodType,
  description = "Success.",
): Record<number, ResponseSpec> {
  return response(200, description, schema);
}

export function createdResponse(
  schema?: z.ZodType,
  description = "Created.",
): Record<number, ResponseSpec> {
  return response(201, description, schema);
}

export function noContentResponse(
  description = "No content.",
): Record<number, ResponseSpec> {
  return response(204, description);
}

export function emptyResponse(
  status: number,
  description: string,
): Record<number, ResponseSpec> {
  return response(status, description);
}

/** A non-JSON (SSE/binary) 200 response; media type only, no schema. */
export function streamResponse(
  contentType: string,
  description: string,
): Record<number, ResponseSpec> {
  return { 200: { description, contentType } };
}

/* --- Domain enums (mirrors of the code constants) ------------------------- */

export const INBOX_VIEWS = [
  "needs_reply",
  "follow_up_today",
  "meetings",
  "waiting",
  "ai_handled",
  "fyi",
] as const;

export const PENDING_ACTION_STATUSES = [
  "PENDING",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;

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

export const COMPOSE_ASSIST_ACTIONS = [
  "complete",
  "rewrite",
  "shorten",
  "formal",
  "casual",
  "bulletize",
  "translate",
  "write",
] as const;

export const ASSET_KINDS = ["image", "file"] as const;

export const CAMPAIGN_REPLY_POLICIES = ["off", "drafts", "autopilot"] as const;
