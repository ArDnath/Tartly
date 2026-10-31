import { apiError, created } from "@/lib/api/http";
import { mailCreateDraftBody as schema } from "@/lib/api/contracts/mail";
import { expandSnippets } from "@/lib/ai/features/knowledge";
import {
  buildHtmlWithImages,
  resolveOutboundAssets,
} from "@/lib/assets/outbound";
import { connectedMailProviders } from "@/lib/mail/accounts";
import { withMailUser } from "@/lib/mail/route";
import { saveDraft } from "@/lib/mail/service";
import { isOutlookId } from "@/lib/mail/unified";
import { saveOutlookDraft } from "@/lib/outlook/service";

export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  const {
    to,
    cc,
    bcc,
    subject,
    body,
    threadId,
    inReplyTo,
    account,
    assetIds,
    inlineImageIds,
  } = parsed.data;

  const { text: expandedBody } = await expandSnippets({ userId, text: body });
  const providers = await connectedMailProviders(userId);

  // Drafts keep the same attachment semantics as a send: resolve library
  // assets to bytes now, so a later edit/approval never depends on a file that
  // has since been deleted.
  const assets = await resolveOutboundAssets({
    userId,
    inlineImageIds: inlineImageIds ?? [],
    attachmentIds: assetIds ?? [],
  });
  const html = buildHtmlWithImages(expandedBody, assets.htmlImages);

  const viaOutlook =
    account === "outlook" ||
    (account !== "gmail" &&
      (Boolean(threadId && isOutlookId(threadId)) ||
        (!providers.includes("google") && providers.includes("microsoft"))));

  if (viaOutlook) {
    const draft = await saveOutlookDraft(userId, {
      to,
      ...(cc?.length ? { cc } : {}),
      ...(bcc?.length ? { bcc } : {}),
      subject,
      body: expandedBody,
      ...(html ? { html } : {}),
      ...(assets.inlineImages.length
        ? { inlineImages: assets.inlineImages }
        : {}),
      ...(assets.attachments.length
        ? { attachments: assets.attachments }
        : {}),
      ...(threadId && isOutlookId(threadId)
        ? { threadId: threadId.slice("outlook:".length) }
        : {}),
      ...(inReplyTo ? { inReplyTo } : {}),
    });
    // Namespace the draft id so a later update/list routes back to Graph.
    return created({ id: `outlook:${draft.id}` });
  }

  const draft = await saveDraft(userId, {
    to,
    ...(cc?.length ? { cc } : {}),
    ...(bcc?.length ? { bcc } : {}),
    subject,
    body: expandedBody,
    ...(html ? { html } : {}),
    ...(assets.inlineImages.length
      ? { inlineImages: assets.inlineImages }
      : {}),
    ...(assets.attachments.length
      ? { attachments: assets.attachments }
      : {}),
    ...(threadId ? { threadId } : {}),
    ...(inReplyTo ? { inReplyTo } : {}),
  });

  return created({ id: draft.id });
});
