import { z } from "zod";

import { defineOperation } from "./registry";
import {
  createdResponse,
  dataEnvelope,
  noContentResponse,
  okResponse,
} from "./shared";

/** Standalone meetings, reschedule/cancel, briefs and slot booking (Phase C1). */

export const meetingCreateBody = z.object({
  subject: z.string().trim().min(1).max(200),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  attendees: z.array(z.string().email()).max(20).optional(),
});

export const meetingRescheduleBody = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
});

export const meetingBookBody = z.object({
  threadId: z.string().min(1),
  slotIndex: z.number().int().min(0).max(9),
});

/** `GET /meetings` is bounded; a page defaults to 200 and caps at 500. */
export const meetingsListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const meetingOperations = [
  defineOperation({
    method: "GET",
    path: "/api/v1/meetings",
    operationId: "listMeetings",
    tags: ["meetings"],
    summary: "List meetings (most recent first, bounded)",
    security: "session",
    query: meetingsListQuery,
    responses: okResponse(
      dataEnvelope(z.object({ meetings: z.array(z.unknown()) })),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/meetings",
    operationId: "createMeeting",
    tags: ["meetings"],
    summary: "Create a standalone meeting",
    security: "session",
    body: meetingCreateBody,
    responses: createdResponse(dataEnvelope(z.object({ meeting: z.unknown() }))),
  }),
  defineOperation({
    method: "PATCH",
    path: "/api/v1/meetings/{id}",
    operationId: "rescheduleMeeting",
    tags: ["meetings"],
    summary: "Reschedule a meeting",
    security: "session",
    body: meetingRescheduleBody,
    responses: okResponse(dataEnvelope(z.object({ meeting: z.unknown() }))),
  }),
  defineOperation({
    method: "DELETE",
    path: "/api/v1/meetings/{id}",
    operationId: "cancelMeeting",
    tags: ["meetings"],
    summary: "Cancel a meeting",
    security: "session",
    responses: noContentResponse(),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/meetings/{id}/brief",
    operationId: "getMeetingBrief",
    tags: ["meetings"],
    summary: "Read the cached meeting brief",
    security: "session",
    responses: okResponse(
      dataEnvelope(z.object({ brief: z.unknown(), enabled: z.boolean() })),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/meetings/{id}/brief",
    operationId: "generateMeetingBrief",
    tags: ["meetings"],
    summary: "Generate a meeting brief",
    security: "session",
    responses: okResponse(dataEnvelope(z.object({ brief: z.unknown() }))),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/meetings/book",
    operationId: "bookMeetingSlot",
    tags: ["meetings"],
    summary: "Book a proposed slot for a thread",
    security: "session",
    body: meetingBookBody,
    responses: okResponse(
      dataEnvelope(
        z.object({
          id: z.string(),
          startAt: z.string().nullable(),
          endAt: z.string().nullable(),
          meetLink: z.string().nullable(),
          status: z.string(),
        }),
      ),
    ),
  }),
] as const;
