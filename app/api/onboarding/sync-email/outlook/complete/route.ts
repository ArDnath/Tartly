import { NextResponse } from "next/server";

import { ensureMailboxForUser } from "@/lib/email-operator/mailbox";
import { publicOrigin } from "@/lib/http/public-origin";
import {
  MICROSOFT_CONNECT_ERROR_CALLBACK_PATH,
  MICROSOFT_EMAIL_PROVIDER,
  ONBOARDING_COMPLETION_PATH,
} from "@/lib/onboarding/constants";
import {
  advanceOnboarding,
  getOrCreateOnboardingState,
} from "@/lib/onboarding/server";
import { ONBOARDING_STATUS } from "@/lib/onboarding/types";
import {
  hasScope,
  MICROSOFT_MAIL_ACCESS_SCOPE,
} from "@/lib/outlook/scopes";
import { googleAccountRepository } from "@/lib/repositories/google-account";
import { getSession } from "@/lib/session";

/**
 * OAuth landing point for the Outlook connect option.
 *
 * Better Auth has already linked the Microsoft account when we get here. This
 * verifies the mailbox scope was actually granted (a sign-in grant alone cannot
 * read mail), records the provider and advances onboarding. The mailbox row and
 * first Graph sync are created by the normal self-heal path after the redirect.
 */
export async function GET() {
  const origin = publicOrigin();
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/auth", origin));
  }

  const scopes = await googleAccountRepository.listScopesByUserAndProvider({
    userId: session.user.id,
    providerId: MICROSOFT_EMAIL_PROVIDER,
  });
  const connected = scopes.some((scope) =>
    hasScope(scope, MICROSOFT_MAIL_ACCESS_SCOPE),
  );
  if (!connected) {
    return NextResponse.redirect(
      new URL(MICROSOFT_CONNECT_ERROR_CALLBACK_PATH, origin),
    );
  }

  const current = await getOrCreateOnboardingState(session.user.id);
  let justCompleted = false;

  if (current.status === ONBOARDING_STATUS.SYNC_EMAIL) {
    const { snapshot } = await advanceOnboarding({
      userId: session.user.id,
      stepHistoryEffect: "recordAsReversible",
      statusPatch: { connectedEmailProvider: MICROSOFT_EMAIL_PROVIDER },
    });
    justCompleted = snapshot.status === ONBOARDING_STATUS.COMPLETED;
  }

  await ensureMailboxForUser(session.user.id).catch((error) => {
    console.error("[onboarding] Outlook mailbox bootstrap failed", error);
    return null;
  });

  return NextResponse.redirect(
    new URL(
      justCompleted ? ONBOARDING_COMPLETION_PATH : "/onboarding",
      origin,
    ),
  );
}
