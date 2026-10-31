import { type NextRequest } from "next/server";

import { handleGmailPush } from "@/lib/email-operator/webhook";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Google Pub/Sub push endpoint for Gmail `users.watch` notifications.
 *
 * Contract: verify the OIDC token (fail closed), dedupe on `historyId`, record
 * the event, acknowledge fast, then process inside this invocation via
 * `after()`. The handler never waits for the model — a slow triage must not make
 * Pub/Sub redeliver. The decision logic lives in
 * `@/lib/email-operator/webhook` so it stays a single testable unit.
 */
export async function POST(request: NextRequest) {
  return handleGmailPush(request);
}
