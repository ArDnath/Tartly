import { ok } from "@/lib/api/http";
import { withMailUser } from "@/lib/mail/route";
import { getThread } from "@/lib/mail/service";

/** GET /api/v1/mail/threads/{id} — the whole conversation, oldest first. */
export const GET = withMailUser<{ params: Promise<{ id: string }> }>(
  async (userId, _request, context) => {
    const { id } = await context.params;
    return ok(await getThread(userId, id));
  },
);
