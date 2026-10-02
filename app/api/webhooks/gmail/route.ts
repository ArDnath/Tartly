import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";

import { jsonError } from "@/lib/api/error-envelope";
import { recordEvent, processGmailEvent } from "@/lib/email-operator/events";
import { findMailboxByEmail } from "@/lib/email-operator/mailbox";
import { getPubSubAudience, isEmailOperatorEnabled } from "@/lib/env";
import { decodeGmailPushData, verifyGoogleOidcToken } from "@/lib/gmail/pubsub";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Google Pub/Sub push endpoint for Gmail `users.watch` notifications.
 *
 * Contract: verify the OIDC token (fail closed), dedupe on `historyId`, record
 * the event, acknowledge fast, then process inside this invocation via
 * `after()`. The handler never waits for the model — a slow triage must not
 * make Pub/Sub redeliver.
 */
export async function POST(request: NextRequest) {
  if (!isEmailOperatorEnabled()) {
    return jsonError("disabled", "Email operator is not enabled.", 503);
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return jsonError("unauthorized", "Missing OIDC token.", 401);
  }

  try {
    await verifyGoogleOidcToken(
      authorization.slice("Bearer ".length).trim(),
      getPubSubAudience(),
    );
  } catch (error) {
    console.warn("[webhooks/gmail] OIDC verification failed", error);
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

  if (isNew) {
    after(async () => {
      try {
        await processGmailEvent(id);
      } catch (error) {
        console.error("[webhooks/gmail] processing failed", error);
      }
    });
  }

  return NextResponse.json({ data: { accepted: true, deduped: !isNew } });
}
