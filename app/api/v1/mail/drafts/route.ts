import { apiError, created } from "@/lib/api/http";
import { mailCreateDraftBody as schema } from "@/lib/api/contracts/mail";
import { expandSnippets } from "@/lib/ai/features/knowledge";
import { withMailUser } from "@/lib/mail/route";
import { saveDraft } from "@/lib/mail/service";

export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  const { to, cc, bcc, subject, body, threadId, inReplyTo } = parsed.data;

  const { text: expandedBody } = await expandSnippets({ userId, text: body });

  const draft = await saveDraft(userId, {
    to,
    ...(cc?.length ? { cc } : {}),
    ...(bcc?.length ? { bcc } : {}),
    subject,
    body: expandedBody,
    ...(threadId ? { threadId } : {}),
    ...(inReplyTo ? { inReplyTo } : {}),
  });

  return created({ id: draft.id });
});
