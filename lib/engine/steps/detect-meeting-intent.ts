import "server-only";

import { z } from "zod";

import { defineStep } from "@/lib/engine/step";
import { readTrigger } from "./helpers";

const DEFAULT_KEYWORDS = [
  "meet",
  "meeting",
  "call",
  "schedule",
  "calendar",
  "availability",
  "available",
  "book",
  "slot",
  "sync up",
  "catch up",
  "1:1",
];

/** Deterministic meeting detection (mirrors the triage heuristic). */
export function detectMeetingIntent({
  subject,
  body,
  keywords = DEFAULT_KEYWORDS,
}: {
  subject: string | null;
  body: string;
  keywords?: string[];
}): { isMeeting: boolean; durationMins?: number } {
  const text = `${subject ?? ""}\n${body}`.toLowerCase();
  const isMeeting = keywords.some((keyword) => text.includes(keyword.toLowerCase()));

  if (!isMeeting) return { isMeeting: false };

  const durationMatch = text.match(/\b(\d{1,3})\s*(min|minutes|mins)\b/);
  const durationMins = durationMatch ? Number(durationMatch[1]) : undefined;
  return { isMeeting: true, durationMins };
}

export const detectMeetingIntentStep = defineStep({
  type: "detect-meeting-intent",
  configSchema: z.object({
    keywords: z.array(z.string()).optional(),
  }),
  async run(ctx) {
    const latest = ctx.state.latestMessage as
      | { subject?: string | null; text?: string | null }
      | undefined;

    // Classify-intent already decided this; trust it, but also re-check text
    // so the step works even if it is run standalone.
    const fromText = detectMeetingIntent({
      subject: latest?.subject ?? null,
      body: latest?.text ?? "",
      keywords: ctx.input.keywords,
    });

    const isMeeting = ctx.state.wantsMeeting === true || fromText.isMeeting;
    const result = { isMeeting, durationMins: fromText.durationMins };

    ctx.log("detect-meeting-intent", { ...result, trigger: readTrigger(ctx.state) });
    return result;
  },
});
