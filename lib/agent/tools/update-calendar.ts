import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  respondToCalendarEvent,
  updateCalendarEvent,
  type CalendarResponseStatus,
} from "@/lib/calendar/events";

import { recipientSchema, requireSendPermission } from "./shared";

/**
 * `update_calendar` — EXTERNAL_SIDE_EFFECT.
 *
 * Creates, reschedules, cancels, or RSVPs to a Google Calendar event. It is
 * gated exactly like a send: the model can only *propose* it, the user's
 * confirmation runs this tool once, and `execute` refuses to run without a
 * server-owned `pendingActionId`. `idempotencyKey` is forwarded as the Google
 * event request id, so a replay cannot create a second event.
 */

const MAX_ATTENDEES = 50;

const responseStatusEnum = z.enum([
  "accepted",
  "declined",
  "tentative",
  "needsAction",
]);

const inputSchema = z
  .object({
    action: z
      .enum(["create", "update", "delete", "respond"])
      .describe(
        "create a new event, update (reschedule/rename) one, delete (cancel) one, or respond to an invite.",
      ),
    eventId: z
      .string()
      .min(1)
      .max(1024)
      .optional()
      .describe("Google event id (from search_calendar). Required for update/delete/respond."),
    summary: z
      .string()
      .min(1)
      .max(300)
      .optional()
      .describe("Event title. Required for create."),
    description: z
      .string()
      .max(4_000)
      .optional()
      .describe("Event description / agenda."),
    location: z.string().max(500).optional().describe("Event location."),
    start: z
      .iso
      .datetime({ offset: true })
      .optional()
      .describe("Start instant, ISO 8601 with offset. Required for create/update."),
    end: z
      .iso
      .datetime({ offset: true })
      .optional()
      .describe("End instant, ISO 8601 with offset. Required for create/update."),
    timeZone: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe("IANA time zone for the event. Defaults to the user's."),
    attendees: z
      .array(recipientSchema)
      .max(MAX_ATTENDEES)
      .optional()
      .describe("Guest email addresses (create only)."),
    responseStatus: responseStatusEnum
      .optional()
      .describe("RSVP for respond."),
  })
  .superRefine((value, ctx) => {
    const require = (field: string) =>
      ctx.addIssue({ code: "custom", message: `${field} is required for ${value.action}.` });

    if (value.action === "create") {
      if (!value.summary) require("summary");
      if (!value.start) require("start");
      if (!value.end) require("end");
    }
    if (value.action === "update") {
      if (!value.eventId) require("eventId");
      if (!value.start) require("start");
      if (!value.end) require("end");
    }
    if (value.action === "delete" && !value.eventId) require("eventId");
    if (value.action === "respond") {
      if (!value.eventId) require("eventId");
      if (!value.responseStatus) require("responseStatus");
    }
  });

export type UpdateCalendarInput = z.infer<typeof inputSchema>;

function buildUpdateCalendarTool(): AnyToolDefinition {
  return defineTool({
    name: "update_calendar",
    description:
      "Create, reschedule, cancel, or RSVP to a Google Calendar event. Calling this does NOT change anything yet: it creates a confirmation card the user must approve, and only then does it run. For update/delete/respond, pass the eventId from search_calendar. Times are ISO 8601 with an offset.",
    risk: "EXTERNAL_SIDE_EFFECT",
    inputSchema,
    authorize(ctx) {
      requireSendPermission(ctx);
    },
    async execute(ctx, input) {
      if (!ctx.pendingActionId) {
        throw new Error("update_calendar can only run from a confirmed action.");
      }

      const timeZone = input.timeZone ?? ctx.timezone;

      if (input.action === "create") {
        const event = await createCalendarEvent({
          userId: ctx.userId,
          summary: input.summary!,
          startUtc: new Date(input.start!),
          endUtc: new Date(input.end!),
          timeZone,
          ...(input.description ? { description: input.description } : {}),
          ...(input.attendees?.length ? { attendees: input.attendees } : {}),
          requestId: ctx.idempotencyKey ?? ctx.pendingActionId,
        });
        return {
          created: true,
          eventId: event.id,
          htmlLink: event.htmlLink,
          meetLink: event.meetLink,
          summary: input.summary,
          start: input.start,
          end: input.end,
          notice: "Event created and invites sent.",
        };
      }

      if (input.action === "update") {
        await updateCalendarEvent({
          userId: ctx.userId,
          eventId: input.eventId!,
          startUtc: new Date(input.start!),
          endUtc: new Date(input.end!),
          timeZone,
          ...(input.summary ? { summary: input.summary } : {}),
        });
        return {
          updated: true,
          eventId: input.eventId,
          start: input.start,
          end: input.end,
          notice: "Event rescheduled; guests were notified.",
        };
      }

      if (input.action === "delete") {
        await deleteCalendarEvent({ userId: ctx.userId, eventId: input.eventId! });
        return {
          deleted: true,
          eventId: input.eventId,
          notice: "Event cancelled and removed from the calendar.",
        };
      }

      const result = await respondToCalendarEvent({
        userId: ctx.userId,
        eventId: input.eventId!,
        responseStatus: input.responseStatus as CalendarResponseStatus,
      });
      return {
        responded: true,
        eventId: input.eventId,
        responseStatus: result.responseStatus,
        notice: "Your RSVP was recorded on the event.",
      };
    },
  });
}

/** `update_calendar` — EXTERNAL_SIDE_EFFECT. */
export const updateCalendarTool = buildUpdateCalendarTool();
