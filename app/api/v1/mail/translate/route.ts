import { apiError, ok } from "@/lib/api/http";
import { mailTranslateBody as schema } from "@/lib/api/contracts/mail";
import { translateText } from "@/lib/ai/features/translate";
import { isTranslateEnabled } from "@/lib/env";
import { withMailUser } from "@/lib/mail/route";

/** Translate text (Phase 5). Returns plain text; never sends. */
export const POST = withMailUser({ requiresSubscription: true }, async (userId, request) => {
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
