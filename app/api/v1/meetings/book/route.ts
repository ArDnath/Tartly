import { z } from "zod";

import { ok, apiError, withUser } from "@/lib/api/http";
import { bookSlot } from "@/lib/calendar/booking";

const bodySchema = z.object({
  threadId: z.string().min(1),
  slotIndex: z.number().int().min(0).max(9),
});

export const POST = withUser(async (userId, request) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  const meeting = await bookSlot({
    userId,
    threadId: parsed.data.threadId,
    slotIndex: parsed.data.slotIndex,
  });
  if (!meeting) return apiError("not_found", "No proposed slot to book", 404);

  return ok({
    id: meeting.id,
    startAt: meeting.startAt ? meeting.startAt.toISOString() : null,
    endAt: meeting.endAt ? meeting.endAt.toISOString() : null,
    meetLink: meeting.meetLink,
    status: meeting.status,
  });
});
