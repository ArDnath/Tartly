import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db, pool } from "@/lib/db";
import { account } from "@/lib/db/schema";
import { JOB_KIND_MAILBOX_SYNC } from "@/lib/email-operator/job-kinds";
import { ensureMailbox } from "@/lib/email-operator/mailbox";
import { env } from "@/lib/env";
import { getGmailProfile } from "@/lib/gmail/sync";
import { registerMailboxWatch } from "@/lib/gmail/watch";
import {
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_CONNECT_ERROR_CALLBACK_PATH,
  GOOGLE_CONNECT_SCOPES,
  GOOGLE_EMAIL_PROVIDER,
  ONBOARDING_COMPLETION_PATH,
} from "@/lib/onboarding/constants";
import { hasGrantedScopes } from "@/lib/onboarding/scopes";
import {
  advanceOnboarding,
  getOrCreateOnboardingState,
} from "@/lib/onboarding/server";
import { ONBOARDING_STATUS } from "@/lib/onboarding/types";
import { enqueueJob } from "@/lib/queue/queue";
import { getSession } from "@/lib/session";

/**
 * OAuth landing point for the "sync your inbox" step. Better Auth has already
 * linked the Google account and persisted its tokens by the time we get here;
 * this handler verifies the inbox scopes were actually granted, records the
 * connection on the onboarding row, and forwards the user to the next step.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.redirect(new URL("/auth", origin));
  }

  const accounts = await db
    .select({ scope: account.scope })
    .from(account)
    .where(
      and(
        eq(account.userId, session.user.id),
        eq(account.providerId, GOOGLE_EMAIL_PROVIDER),
      ),
    );

  const grantedScopeStrings = accounts.map((row) => row.scope);
  const connected = grantedScopeStrings.some((scope) =>
    hasGrantedScopes(scope, GOOGLE_CONNECT_SCOPES),
  );

  if (!connected) {
    return NextResponse.redirect(
      new URL(GOOGLE_CONNECT_ERROR_CALLBACK_PATH, origin),
    );
  }

  // Calendar is optional: when the grant omits it, the appended CALENDAR_SETUP
  // step auto-advances so the user is never blocked on a step they can't use.
  const calendarConnected = grantedScopeStrings.some((scope) =>
    hasGrantedScopes(scope, GOOGLE_CALENDAR_SCOPES),
  );

  const current = await getOrCreateOnboardingState(session.user.id);

  // Only advance when the user is actually parked on this step, so a stale
  // tab can't skip a later step.
  let justCompleted = false;

  if (current.status === ONBOARDING_STATUS.SYNC_EMAIL) {
    const { snapshot } = await advanceOnboarding({
      userId: session.user.id,
      stepHistoryEffect: "recordAsReversible",
      statusPatch: {
        connectedEmailProvider: GOOGLE_EMAIL_PROVIDER,
        ...(calendarConnected
          ? { connectedCalendarProvider: GOOGLE_EMAIL_PROVIDER }
          : {}),
      },
    });

    if (
      snapshot.status === ONBOARDING_STATUS.CALENDAR_SETUP &&
      !calendarConnected
    ) {
      // The user granted no calendar scope, so the calendar step is unusable:
      // finish onboarding here. Track the completion so the redirect below
      // hands off to Mail with the welcome animation instead of dropping the
      // user onto `/mail` without it.
      const autoAdvance = await advanceOnboarding({
        userId: session.user.id,
        stepHistoryEffect: "leaveUnchanged",
      });
      justCompleted = autoAdvance.justCompleted;
    }
  }

  // Best-effort mailbox bootstrap: create the mailbox, start a watch when
  // Pub/Sub is configured, and queue the initial sync + triage. A Gmail hiccup
  // must never block onboarding, so this deliberately swallows its errors.
  try {
    const profile = await getGmailProfile(session.user.id);
    const mailbox = await ensureMailbox({
      userId: session.user.id,
      email: profile.emailAddress ?? session.user.email,
      historyId: profile.historyId ?? null,
    });

    if (env.GOOGLE_PUBSUB_TOPIC) {
      await registerMailboxWatch({
        userId: session.user.id,
        mailboxId: mailbox.id,
        topicName: env.GOOGLE_PUBSUB_TOPIC,
      });
    }

    // Deduped on the mailbox id so a replayed callback cannot double-queue.
    await enqueueJob(pool, session.user.id, {
      kind: JOB_KIND_MAILBOX_SYNC,
      laneKey: `mailbox:${mailbox.id}`,
      payload: { mailboxId: mailbox.id },
      sourceEventId: `connect:${mailbox.id}`,
    });
  } catch (error) {
    console.error("[onboarding] mailbox bootstrap failed", error);
  }

  return NextResponse.redirect(
    new URL(
      justCompleted ? ONBOARDING_COMPLETION_PATH : "/onboarding",
      origin,
    ),
  );
}
