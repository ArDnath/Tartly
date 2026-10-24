import { NextResponse, type NextRequest } from "next/server";

import {
  syncDodoCreditPayment,
  syncDodoPayment,
  syncDodoSubscription,
} from "@/lib/billing/dodo";
import { publicUrl } from "@/lib/http/public-origin";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/billing/return — the post-checkout landing.
 *
 * Dodo sends the browser here after a subscription *or* a one-time credit-pack
 * payment (success or cancel). A redirect is never proof of payment, so we
 * re-fetch the reference from Dodo server-side, confirm it belongs to the
 * signed-in user, mirror the result, then send the user straight to their inbox
 * with a status flag. There is no intermediate "choose what to do" screen.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  const subscriptionId = params.get("subscription_id");
  const paymentId = params.get("payment_id");

  const target = (flag: "success" | "cancelled" | "pending") => {
    const url = publicUrl("/mail");
    url.searchParams.set("billing", flag);
    return NextResponse.redirect(url);
  };

  // Dodo's cancel_url carries `status=cancelled`; honour it before reconciling.
  if (status === "cancelled" || status === "failed") {
    return target("cancelled");
  }

  const session = await getSession();
  const userId = session?.user?.id ?? undefined;

  let applied = false;
  try {
    if (subscriptionId) {
      const result = await syncDodoSubscription(subscriptionId, userId);
      applied = applied || result.applied;
    }
    if (paymentId) {
      const [sub, credit] = await Promise.all([
        syncDodoPayment(paymentId, userId),
        syncDodoCreditPayment(paymentId, userId),
      ]);
      applied = applied || sub.applied || credit.applied;
    }
  } catch (error) {
    console.error("[billing/return] reconcile failed", error);
  }

  // A reconcile can lag the redirect (rare). Either way the user lands in their
  // inbox; the billing status poll picks up the entitlement a moment later.
  return target(applied || !subscriptionId && !paymentId ? "success" : "pending");
}
