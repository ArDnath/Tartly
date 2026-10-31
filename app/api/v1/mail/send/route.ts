import { nanoid } from "nanoid";

import { mailSendBody as schema } from "@/lib/api/contracts/mail";
import { apiError, ok } from "@/lib/api/http";
import {
  releaseMailSend,
  reserveMailSend,
} from "@/lib/billing/entitlements";
import { paymentRequired } from "@/lib/billing/http";
import {
  buildHtmlWithImages,
  resolveOutboundAssets,
} from "@/lib/assets/outbound";
import { expandSnippets } from "@/lib/ai/features/knowledge";
import { sendEmail } from "@/lib/gmail/send";
import { connectedMailProviders } from "@/lib/mail/accounts";
import { allowMailSend } from "@/lib/mail/rate-limit";
import { withMailUser } from "@/lib/mail/route";
import { profile } from "@/lib/mail/service";
import { isOutlookId } from "@/lib/mail/unified";
import { sendOutlookEmail } from "@/lib/outlook/send";

/**
 * Sends mail. Gmail goes through the single idempotent path (`sendEmail`) so a
 * retried request can never double-send; a fresh idempotency key per request is
 * what makes each user-initiated send distinct. When the reply belongs to an
 * Outlook conversation the message is sent through Microsoft Graph instead.
 */
export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  if (!(await allowMailSend(userId))) {
    return apiError("rate_limited", "Too many messages. Try again shortly.", 429);
  }

  const { to, cc, bcc, subject, body, threadId, inReplyTo, assetIds, inlineImageIds, account } =
    parsed.data;

  // Sending from Outlook when the caller says so, or when the thread it belongs
  // to is an Outlook conversation (its id carries the `outlook:` namespace).
  const viaOutlook =
    account === "outlook" ||
    (account !== "gmail" && Boolean(threadId && isOutlookId(threadId)));

  // Reserve one of the free sends before doing any work. The reservation is
  // released only if the send itself fails, so a failed attempt is free.
  const reservation = await reserveMailSend(
    userId,
    threadId ? "reply" : "send",
  );
  if (!reservation.allowed) {
    return paymentRequired(reservation.entitlement, "mail_send");
  }

  try {
    // Expand `{{snippet:shortcut}}` server-side so it works from any composer.
    const { text: expandedBody } = await expandSnippets({ userId, text: body });
    const providers = await connectedMailProviders(userId);

    // A reply to an Outlook thread always goes back through Graph. A brand-new
    // message uses Outlook only when no Gmail account is connected.
    const target =
      viaOutlook || !providers.includes("google") ? "outlook" : "gmail";

    // Resolve assets to bytes now (Phase 6); deleting them later leaves sent mail intact.
    const assets = await resolveOutboundAssets({
      userId,
      inlineImageIds: inlineImageIds ?? [],
      attachmentIds: assetIds ?? [],
    });
    const html = buildHtmlWithImages(expandedBody, assets.htmlImages);

    if (target === "outlook") {
      if (!providers.includes("microsoft")) {
        await releaseMailSend(reservation.eventId);
        return apiError("no_mailbox", "No connected Outlook account", 409);
      }
      await sendOutlookEmail({
        userId,
        idempotencyKey: `mail:${nanoid()}`,
        email: {
          from: "",
          to,
          ...(cc?.length ? { cc } : {}),
          ...(bcc?.length ? { bcc } : {}),
          subject,
          text: expandedBody,
          ...(html ? { html } : {}),
          ...(assets.inlineImages.length
            ? { inlineImages: assets.inlineImages }
            : {}),
          ...(assets.attachments.length
            ? { attachments: assets.attachments }
            : {}),
          ...(inReplyTo ? { inReplyTo, references: [inReplyTo] } : {}),
        },
      });
      return ok({ id: "", threadId: threadId ?? "" });
    }

    if (!providers.includes("google")) {
      await releaseMailSend(reservation.eventId);
      return apiError("no_mailbox", "No connected mailbox", 409);
    }
    const sender = await profile(userId);

    const result = await sendEmail({
      userId,
      email: {
        from: sender.emailAddress,
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
  } catch (error) {
    await releaseMailSend(reservation.eventId);
    throw error;
  }
});
