import { ok } from "@/lib/api/http";
import { consumeMailView } from "@/lib/billing/entitlements";
import { paymentRequired } from "@/lib/billing/http";
import { withMailUser } from "@/lib/mail/route";
import { getUnifiedThread } from "@/lib/mail/unified";

/** GET /api/v1/mail/threads/{id} — the whole conversation, oldest first. */
export const GET = withMailUser<{ params: Promise<{ id: string }> }>(
  async (userId, _request, context) => {
    const { id } = await context.params;
    const thread = await getUnifiedThread(userId, id);

    // A conversation counts once, keyed by its newest message. Re-opening a
    // conversation the user already saw never costs another allowance.
    const newest = thread.messages[thread.messages.length - 1]?.id ?? id;
    const view = await consumeMailView(userId, newest);
    if (!view.allowed) {
      return paymentRequired(view.entitlement, "mail_view");
    }

    return ok(thread);
  },
);
