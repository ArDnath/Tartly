import { ok, withUser } from "@/lib/api/http";
import { listReplyMemories } from "@/lib/ai/features/reply-memory";

/** The user's learned reply memories — visible and deletable. */
export const GET = withUser(async (userId) => {
  return ok({ memories: await listReplyMemories({ userId }) });
});
