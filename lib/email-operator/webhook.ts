import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";

import { jsonError } from "@/lib/api/error-envelope";
import { drainQueue } from "@/lib/email-operator/drain";
import { recordEvent, processGmailEvent } from "@/lib/email-operator/events";
import { findMailboxByEmail } from "@/lib/email-operator/mailbox";
import { incrementCounter } from "@/lib/observability/metrics";
import { logger } from "@/lib/observability/logger";
import {
  getPubSubAudience,
  getPubSubPushServiceAccountEmail,
  isEmailOperatorEnabled,
  webhookDrainBatchSize,
} from "@/lib/env";
import { decodeGmailPushData, verifyGoogleOidcToken } from "@/lib/gmail/pubsub";

/**
 * Google Pub/Sub push handler: verify the OIDC token (fail closed), dedupe on
 * `historyId`, record the event, acknowledge fast, then process inside this
 * invocation via `after()`. The handler never waits for the model — a slow triage
 * must not make Pub/Sub redeliver.
 *
 * Lives in `lib/` (not the route file) so the verification/dedupe/drain decision
 * tree is a single, unit-testable unit of behaviour.
 */
export async function handleGmailPush(request: NextRequest): Promise<NextResponse> {
  if (!isEmailOperatorEnabled()) {
    return jsonError("disabled", "Email operator is not enabled.", 503);
  }

  const pushServiceAccountEmail = getPubSubPushServiceAccountEmail();
  if (!pushServiceAccountEmail) {
    // A signed token without a pinned sender is insufficient for this public
    // endpoint. Fail closed until the identity configured on the subscription
    // is declared explicitly in the server environment.
    return jsonError(
      "misconfigured",
      "Gmail push authentication is not configured.",
      503,
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return jsonError("unauthorized", "Missing OIDC token.", 401);
  }

  try {
    await verifyGoogleOidcToken(
      authorization.slice("Bearer ".length).trim(),
      {
        audience: getPubSubAudience(),
        serviceAccountEmail: pushServiceAccountEmail,
      },
    );
  } catch (error) {
    logger.warn("webhook_oidc_verification_failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return jsonError("unauthorized", "Invalid OIDC token.", 401);
  }

  let payload;
  try {
    const body = (await request.json()) as { message?: { data?: string } };
    const data = body.message?.data;
    if (!data) throw new Error("missing message.data");
    payload = decodeGmailPushData(data);
  } catch (error) {
    return jsonError(
      "bad_request",
      error instanceof Error ? error.message : "Invalid payload.",
      400,
    );
  }

  const mailbox = await findMailboxByEmail(payload.emailAddress);
  if (!mailbox) {
    // Unknown inbox: acknowledge so Pub/Sub stops retrying.
    return NextResponse.json({ data: { ignored: true } });
  }

  const { id, isNew } = await recordEvent({
    userId: mailbox.userId,
    kind: "gmail.push",
    externalId: payload.historyId,
    payload: {
      emailAddress: payload.emailAddress,
      historyId: payload.historyId,
    },
  });

  incrementCounter("webhook_events_total", {
    deduped: isNew ? "false" : "true",
  });

  if (isNew) {
    after(async () => {
      try {
        await processGmailEvent(id);
        // Fix G-01: the webhook enqueued the job but nothing drained it. Run a
        // bounded drain in this same invocation so new mail is triaged (and,
        // when eligible, auto-sent) without the user opening the app. A drain
        // failure must never change the 200 ack or block other work.
        await drainQueue({
          workerId: `webhook:${id}:${Date.now().toString(36)}`,
          batchSize: webhookDrainBatchSize(),
        });
        incrementCounter("webhook_processed_total");
      } catch (error) {
        incrementCounter("webhook_processing_failed_total");
        logger.error("webhook_processing_failed", {
          eventId: id,
          error: error instanceof Error ? error.name : "unknown",
        });
      }
    });
  }

  return NextResponse.json({ data: { accepted: true, deduped: !isNew } });
}
