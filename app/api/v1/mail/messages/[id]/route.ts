import { ok } from "@/lib/api/http";
import { withMailUser } from "@/lib/mail/route";
import { getMessage } from "@/lib/mail/service";

export const GET = withMailUser<{ params: Promise<{ id: string }> }>(
  async (userId, _request, context) => {
    const { id } = await context.params;
    return ok(await getMessage(userId, id));
  },
);
