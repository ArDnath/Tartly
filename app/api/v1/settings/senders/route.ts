import { apiError, ok, withUser } from "@/lib/api/http";
import { sendersPatchBody as patchSchema } from "@/lib/api/contracts/settings";
import {
  getAssistantSettings,
  updateAssistantSettings,
} from "@/lib/ai/features/draft-context";
import {
  getSenderCategoryCounts,
  listSenderProfiles,
} from "@/lib/ai/features/sender-profiles";

/**
 * Sender intelligence settings (Phase 2).
 *
 * `GET`  — the per-user sender controls, category rollup and sender list.
 * `PATCH`— toggle sender intelligence, the cold-email action and noise archiving.
 */

export const GET = withUser(async (userId) => {
  const [config, profiles, categoryCounts] = await Promise.all([
    getAssistantSettings(userId),
    listSenderProfiles({ userId, limit: 300 }),
    getSenderCategoryCounts(userId),
  ]);

  return ok({
    settings: {
      senderIntelEnabled: config.senderIntelEnabled,
      coldEmailAction: config.coldEmailAction,
      autoArchiveNoise: config.autoArchiveNoise,
    },
    categoryCounts,
    senders: profiles.map((profile) => ({
      id: profile.id,
      email: profile.email,
      domain: profile.domain,
      category: profile.category,
      confidence: profile.confidence,
      coldEmailScore: profile.coldEmailScore,
      marketingScore: profile.marketingScore,
      status: profile.status,
      unsubscribeMethod: profile.unsubscribeMethod,
      lastSeenAt: profile.lastSeenAt,
    })),
  });
});

export const PATCH = withUser(async (userId, request) => {
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  await updateAssistantSettings(userId, parsed.data);
  const config = await getAssistantSettings(userId);
  return ok({
    settings: {
      senderIntelEnabled: config.senderIntelEnabled,
      coldEmailAction: config.coldEmailAction,
      autoArchiveNoise: config.autoArchiveNoise,
    },
  });
});
