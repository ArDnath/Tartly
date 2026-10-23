import type { NextRequest } from "next/server";

import { apiError, ok, withUser } from "@/lib/api/http";
import { findCreditPack } from "@/lib/billing/credit-config";
import { createCreditCheckoutSession } from "@/lib/billing/dodo";
import { billingRepository } from "@/lib/repositories/billing";
import { userRepository } from "@/lib/repositories/users";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/credits/checkout — start a one-time credit-pack purchase.
 *
 * Returns the Dodo-hosted checkout URL for the pack; the API key never leaves
 * the server. Credits are granted from the payment webhook (and the return
 * reconcile), never from this call.
 */
export const POST = withUser(async (userId, request: NextRequest) => {
  const body = (await request.json().catch(() => ({}))) as {
    packId?: unknown;
  };
  const pack =
    typeof body.packId === "string" ? findCreditPack(body.packId) : undefined;
  if (!pack) {
    return apiError("bad_request", "Choose a credit pack.", 400);
  }

  const [account, email, name] = await Promise.all([
    billingRepository.ensureAccount(userId),
    userRepository.findEmailById(userId),
    userRepository.findNameById(userId),
  ]);

  const session = await createCreditCheckoutSession({
    userId,
    email,
    name,
    pack,
    origin: request.nextUrl.origin,
    existingCustomerId: account.dodoCustomerId ?? null,
  });

  if (!session.checkoutUrl) {
    return apiError(
      "service_unavailable",
      "Credit purchases are unavailable right now.",
      503,
    );
  }

  return ok({ checkoutUrl: session.checkoutUrl });
});
