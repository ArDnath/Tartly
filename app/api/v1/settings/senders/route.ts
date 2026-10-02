import { z } from "zod";

import {
  getAssistantSettings,
  updateAssistantSettings,
} from "@/lib/ai/features/draft-context";
import {
  getSenderCategoryCounts,
  listSenderProfiles,
} from "@/lib/ai/features/sender-profiles";
import { apiError, ok, withUser } from "@/lib/api/http";

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

const patchSchema = z.object({
  senderIntelEnabled: z.boolean().optional(),
  coldEmailAction: z.enum(["label", "archive", "none"]).optional(),
  autoArchiveNoise: z.boolean().optional(),
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
