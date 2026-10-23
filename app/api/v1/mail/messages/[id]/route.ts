import { ok } from "@/lib/api/http";
import { consumeMailView } from "@/lib/billing/entitlements";
import { paymentRequired } from "@/lib/billing/http";
import { withMailUser } from "@/lib/mail/route";
import { getUnifiedMessage } from "@/lib/mail/unified";

export const GET = withMailUser<{ params: Promise<{ id: string }> }>(
  async (userId, _request, context) => {
    const { id } = await context.params;
    // Consume the distinct-view allowance before returning any content. A
    // subscriber is always allowed; a re-open costs nothing.
    const view = await consumeMailView(userId, id);
    if (!view.allowed) {
      return paymentRequired(view.entitlement, "mail_view");
    }
    return ok(await getUnifiedMessage(userId, id));
  },
);
