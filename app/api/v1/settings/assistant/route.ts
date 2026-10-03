import { apiError, ok, withUser } from "@/lib/api/http";
import {
  assistantActionBody as actionSchema,
  assistantPatchBody as patchSchema,
} from "@/lib/api/contracts/settings";
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

export const PATCH = withUser(async (userId, request) => {
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  await updateAssistantSettings(userId, parsed.data);
  return ok(await getAssistantOverview(userId));
});

/** POST { action: "analyze-style" } — re-analyze the writing voice now. */
export const POST = withUser(async (userId, request) => {
  const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  const result = await refreshWritingStyleIfStale({ userId, force: true });
  return ok({ ...result, overview: await getAssistantOverview(userId) });
});
