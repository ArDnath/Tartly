import { nanoid } from "nanoid";

import { mailSendBody as schema } from "@/lib/api/contracts/mail";
import { apiError, ok } from "@/lib/api/http";
import {
  buildHtmlWithImages,
  resolveOutboundAssets,
} from "@/lib/assets/outbound";
import { expandSnippets } from "@/lib/ai/features/knowledge";
import { getMailboxForUser } from "@/lib/email-operator/mailbox";
import { sendEmail } from "@/lib/gmail/send";
import { allowMailSend } from "@/lib/mail/rate-limit";
import { withMailUser } from "@/lib/mail/route";

/**
 * Sends mail through the single idempotent path (`sendEmail`), so a retried
 * request can never double-send. A fresh idempotency key per request is what
 * makes each user-initiated send distinct.
 */
export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  if (!(await allowMailSend(userId))) {
    return apiError("rate_limited", "Too many messages. Try again shortly.", 429);
  }

  const mailbox = await getMailboxForUser(userId);
  if (!mailbox) {
    return apiError("no_mailbox", "No connected mailbox", 409);
  }

  const { to, cc, bcc, subject, body, threadId, inReplyTo, assetIds, inlineImageIds } =
    parsed.data;

  // Expand `{{snippet:shortcut}}` server-side so it works from any composer.
  const { text: expandedBody } = await expandSnippets({ userId, text: body });

  // Resolve assets to bytes now (Phase 6); deleting them later leaves sent mail intact.
  const assets = await resolveOutboundAssets({
    userId,
    inlineImageIds: inlineImageIds ?? [],
    attachmentIds: assetIds ?? [],
  });
  const html = buildHtmlWithImages(expandedBody, assets.htmlImages);

  const result = await sendEmail({
    userId,
    email: {
      from: mailbox.email,
      to,
      ...(cc?.length ? { cc } : {}),
      ...(bcc?.length ? { bcc } : {}),
      subject,
      text: expandedBody,
      ...(html ? { html } : {}),
      ...(assets.inlineImages.length ? { inlineImages: assets.inlineImages } : {}),
      ...(assets.attachments.length ? { attachments: assets.attachments } : {}),
      ...(inReplyTo ? { inReplyTo, references: [inReplyTo] } : {}),
    },
    gmailThreadId: threadId ?? null,
    idempotencyKey: `mail:${nanoid()}`,
  });

  return ok({ id: result.gmailMessageId, threadId: result.gmailThreadId });
});
