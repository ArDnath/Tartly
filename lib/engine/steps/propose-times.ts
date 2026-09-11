import "server-only";

import { z } from "zod";

import { DEFAULT_CALENDAR_SETTINGS, getCalendarSettings } from "@/lib/calendar/settings";
import { buildProposalId } from "@/lib/calendar/slots";
import { formatSlotLabel } from "@/lib/calendar/tz";
import { defineStep } from "@/lib/engine/step";
import { requireThreadId } from "./helpers";

type SlotInstant = { startUtc: string; endUtc: string };

/** Renders the computed slots into human labels and a stable proposal id. */
export const proposeTimesStep = defineStep({
  type: "propose-times",
  configSchema: z.object({
    maxOptions: z.number().int().min(1).max(6).default(3),
  }),
  async run(ctx) {
    const threadId = requireThreadId(ctx);
    const raw = Array.isArray(ctx.state.slots)
      ? (ctx.state.slots as SlotInstant[])
      : [];

    const settings = (await getCalendarSettings(ctx.userId)) ?? DEFAULT_CALENDAR_SETTINGS;
    const timeZone = settings.timezone;

    const selected = raw
      .filter((slot) => slot?.startUtc && slot?.endUtc)
      .slice(0, ctx.input.maxOptions);

    if (selected.length === 0) {
      ctx.log("propose-times", { options: 0 });
      return { options: [], proposalId: null, slotInstants: [] };
    }

    const options = selected.map((slot) =>
      formatSlotLabel(new Date(slot.startUtc), timeZone),
    );

    const proposalId = buildProposalId(
      threadId,
      selected.map((slot) => ({
        startUtc: new Date(slot.startUtc),
        endUtc: new Date(slot.endUtc),
      })),
    );

    ctx.log("propose-times", { options: options.length, proposalId });
    return { options, proposalId, slotInstants: selected };
  },
});
