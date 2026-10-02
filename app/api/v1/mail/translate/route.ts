import { z } from "zod";

import { apiError, ok } from "@/lib/api/http";
import { translateText } from "@/lib/ai/features/translate";
import { isTranslateEnabled } from "@/lib/env";
import { withMailUser } from "@/lib/mail/route";

const schema = z.object({
  text: z.string().min(1).max(20_000),
  targetLanguage: z.string().min(1).max(40),
});

/** Translate text (Phase 5). Returns plain text; never sends. */
export const POST = withMailUser(async (userId, request) => {
  if (!isTranslateEnabled()) {
    return apiError("disabled", "Translation is disabled.", 403);
  }
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  const result = await translateText({
    userId,
    text: parsed.data.text,
    targetLanguage: parsed.data.targetLanguage,
  });
  return ok(result);
});
