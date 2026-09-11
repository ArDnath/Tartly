import "server-only";

import { z } from "zod";

import { createMeetingForProposal } from "@/lib/calendar/meetings";
import { DEFAULT_CALENDAR_SETTINGS, getCalendarSettings } from "@/lib/calendar/settings";
import { db } from "@/lib/db";
import { threads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { defineStep } from "@/lib/engine/step";
import { requireThreadId } from "./helpers";

type SlotInstant = { startUtc: string; endUtc: string };

/** Books the chosen proposed slot as a calendar event (idempotent). */
export const createEventStep = defineStep({
  type: "create-event",
  configSchema: z.object({
    slotIndex: z.number().int().min(0).max(9).default(0),
  }),
  async run(ctx) {
    const threadId = requireThreadId(ctx);
    const slots = Array.isArray(ctx.state.slotInstants)
      ? (ctx.state.slotInstants as SlotInstant[])
      : [];
    const proposalId =
      typeof ctx.state.proposalId === "string" ? ctx.state.proposalId : null;

    if (slots.length === 0 || !proposalId) {
      throw new Error("create-event requires proposed slots and a proposalId.");
    }

    const slot = slots[ctx.input.slotIndex] ?? slots[0];
    const settings = (await getCalendarSettings(ctx.userId)) ?? DEFAULT_CALENDAR_SETTINGS;

    const threadRows = await db
      .select({ subject: threads.subject })
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);
    const latest = ctx.state.latestMessage as { from?: string | null } | undefined;

    const meeting = await createMeetingForProposal({
      userId: ctx.userId,
      threadId,
      proposalId,
      subject: threadRows[0]?.subject ?? "Meeting",
      startUtc: new Date(slot.startUtc),
      endUtc: new Date(slot.endUtc),
      timeZone: settings.timezone,
      attendees: latest?.from ? [latest.from] : undefined,
    });

    ctx.log("create-event", {
      meetingId: meeting.id,
      status: meeting.status,
    });

    return {
      meetingId: meeting.id,
      eventId: meeting.calendarEventId,
      meetLink: meeting.meetLink,
      startAt: meeting.startAt ? meeting.startAt.toISOString() : slot.startUtc,
      endAt: meeting.endAt ? meeting.endAt.toISOString() : slot.endUtc,
    };
  },
});
