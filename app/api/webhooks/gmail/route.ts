import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";

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
    return NextResponse.json(
      { error: { code: "disabled", message: "Email operator is not enabled." } },
      { status: 503 },
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing OIDC token." } },
      { status: 401 },
    );
  }

  try {
    await verifyGoogleOidcToken(
      authorization.slice("Bearer ".length).trim(),
      getPubSubAudience(),
    );
  } catch (error) {
    console.warn("[webhooks/gmail] OIDC verification failed", error);
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Invalid OIDC token." } },
      { status: 401 },
    );
  }

  let payload;
  try {
    const body = (await request.json()) as { message?: { data?: string } };
    const data = body.message?.data;
    if (!data) throw new Error("missing message.data");
    payload = decodeGmailPushData(data);
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "bad_request",
          message: error instanceof Error ? error.message : "Invalid payload.",
        },
      },
      { status: 400 },
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
