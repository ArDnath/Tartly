import { z } from "zod";

import { apiError, ok, withUser } from "@/lib/api/http";
import {
  getAssistantOverview,
  updateAssistantSettings,
} from "@/lib/ai/features/draft-context";
import { refreshWritingStyleIfStale } from "@/lib/ai/features/writing-style";

/**
 * Assistant settings (Phase 1): voice/memory/knowledge toggles, the draft
 * confidence gate, the explicit style, and on-demand style re-analysis.
 */

export const GET = withUser(async (userId) => {
  return ok(await getAssistantOverview(userId));
});

const patchSchema = z.object({
  voiceEnabled: z.boolean().optional(),
  memoryEnabled: z.boolean().optional(),
  knowledgeEnabled: z.boolean().optional(),
  draftConfidence: z.enum(["all", "standard", "high"]).optional(),
  explicitWritingStyle: z.string().max(2_000).nullable().optional(),
  meetingBriefsEnabled: z.boolean().optional(),
  digestFrequency: z.enum(["off", "daily", "weekly"]).optional(),
  // Morning briefing, commitments & auto-memory.
  briefingEnabled: z.boolean().optional(),
  briefingHour: z.number().int().min(0).max(23).optional(),
  commitmentsEnabled: z.boolean().optional(),
  memoryAutoExtract: z.boolean().optional(),
});

export const PATCH = withUser(async (userId, request) => {
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  await updateAssistantSettings(userId, parsed.data);
  return ok(await getAssistantOverview(userId));
});

const actionSchema = z.object({ action: z.literal("analyze-style") });

/** POST { action: "analyze-style" } — re-analyze the writing voice now. */
export const POST = withUser(async (userId, request) => {
  const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  const result = await refreshWritingStyleIfStale({ userId, force: true });
  return ok({ ...result, overview: await getAssistantOverview(userId) });
});
