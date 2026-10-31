import "server-only";

import {
  defaultGmailTransport,
  GmailApiError,
  GmailAuthError,
  type GmailTransport,
} from "@/lib/gmail/client";
import { AuthorizationError, NotFoundError } from "@/lib/agent/errors";
import {
  applyLabel as gmailApplyLabel,
  archive as gmailArchive,
  deleteMessages as gmailDeleteMessages,
  getDraft as gmailGetDraft,
  getMessage as gmailGetMessage,
  getThread as gmailGetThread,
  isUnreachable,
  listCorrespondents as gmailListCorrespondents,
  listDrafts as gmailListDrafts,
  listMessages,
  profile as gmailProfile,
  removeLabel as gmailRemoveLabel,
  saveDraft as gmailSaveDraft,
  setRead as gmailSetRead,
  setStarred as gmailSetStarred,
  trash as gmailTrash,
  untrash as gmailUntrash,
  updateDraft as gmailUpdateDraft,
  type MailDraft,
  type MailMessage,
} from "@/lib/mail/service";

import type {
  EmailDetail,
  EmailDraft,
  EmailDraftInput,
  EmailProvider,
  EmailSummary,
  FullEmailProvider,
  SearchMessagesResult,
} from "./types";

/**
 * Gmail adapter for the `EmailProvider` contract.
 *
 * It is a thin mapping over the existing live Gmail module
 * (`lib/mail/service.ts`) — the same pass-through the mail client uses — so the
 * agent sees the mailbox Gmail currently holds rather than a possibly-stale
 * mirror. Ownership is enforced upstream: every call resolves the Google
 * account from `userId` via Better Auth.
 *
 * The transport is injectable so tests can exercise the whole write path
 * without touching Google.
 */

function toSummary(message: MailMessage): EmailSummary {
  const outgoing = message.box === "sent" || message.box === "drafts";
  return {
    id: message.id,
    threadId: message.threadId ?? message.id,
    provider: "gmail",
    from: message.from,
    to: message.to,
    ...(message.cc?.length ? { cc: message.cc } : {}),
    subject: message.subject,
    snippet: message.preview,
    receivedAt: message.receivedAt,
    direction: outgoing ? "outbound" : "inbound",
    unread: message.unread,
    starred: message.starred,
    labels: message.labels,
    hasAttachments:
      message.hasAttachments === true || (message.attachments?.length ?? 0) > 0,
  };
}

function toDetail(message: MailMessage): EmailDetail {
  return {
    ...toSummary(message),
    bodyText: message.body,
    ...(message.bodyHtml ? { bodyHtml: message.bodyHtml } : {}),
    ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
    attachments: (message.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      size: attachment.size,
    })),
  };
}

function toDraft(draft: MailDraft): EmailDraft {
  return {
    id: draft.id,
    version: draft.version,
    updatedAt: draft.updatedAt,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    body: draft.body,
    ...(draft.threadId ? { threadId: draft.threadId } : {}),
    ...(draft.inReplyTo ? { inReplyTo: draft.inReplyTo } : {}),
  };
}

function toOutgoing(draft: EmailDraftInput) {
  return {
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    body: draft.body,
    ...(draft.threadId ? { threadId: draft.threadId } : {}),
    ...(draft.inReplyTo ? { inReplyTo: draft.inReplyTo } : {}),
  };
}

/**
 * Translate transport-level Gmail failures into the app's error taxonomy so the
 * agent loop can surface a safe, actionable message and never a raw payload.
 */
function mapGmailError(error: unknown): never {
  if (error instanceof GmailApiError && error.status === 404) {
    throw new NotFoundError("That email or draft could not be found.");
  }
  if (error instanceof GmailAuthError) {
    throw new AuthorizationError(
      "Google access was revoked. Reconnect your account and try again.",
    );
  }
  throw error;
}

export function createGmailEmailProvider(
  transport: GmailTransport = defaultGmailTransport,
): FullEmailProvider {
  const provider: EmailProvider = {
    kind: "gmail",

    async isConnected(userId) {
      try {
        await gmailProfile(userId, transport);
        return true;
      } catch {
        return false;
      }
    },

    async searchMessages({
      userId,
      query,
      box,
      limit,
      pageToken,
    }): Promise<SearchMessagesResult> {
      const page = await listMessages(
        userId,
        { box, search: query, limit, pageToken },
        transport,
      );
      return {
        messages: page.messages.map(toSummary),
        ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
      };
    },

    async getMessage({ userId, messageId }) {
      return toDetail(await gmailGetMessage(userId, messageId, transport));
    },

    async getThread({ userId, threadId }) {
      const thread = await gmailGetThread(userId, threadId, transport);
      return {
        id: thread.id,
        subject: thread.subject,
        messages: thread.messages.map(toDetail),
      };
    },

    async listCorrespondents({ userId, limit }) {
      return gmailListCorrespondents(userId, { ...(limit ? { limit } : {}) }, transport);
    },
  };

  return {
    ...provider,

    async getDraft({ userId, draftId }) {
      try {
        return toDraft(await gmailGetDraft(userId, draftId, transport));
      } catch (error) {
        return mapGmailError(error);
      }
    },

    async listDrafts({ userId, limit }) {
      const drafts = await gmailListDrafts(userId, limit, transport);
      return drafts.map(toDraft);
    },

    async createDraft({ userId, draft }) {
      return toDraft(await gmailSaveDraft(userId, toOutgoing(draft), transport));
    },

    async updateDraft({ userId, draftId, draft }) {
      try {
        return toDraft(
          await gmailUpdateDraft(userId, draftId, toOutgoing(draft), transport),
        );
      } catch (error) {
        return mapGmailError(error);
      }
    },

    async archiveMessage({ userId, messageId }) {
      await gmailArchive(userId, [messageId], transport);
    },

    async trashMessage({ userId, messageId }) {
      await gmailTrash(userId, [messageId], transport);
    },

    async untrashMessage({ userId, messageId }) {
      await gmailUntrash(userId, [messageId], transport);
    },

    async deleteMessage({ userId, messageId }) {
      await gmailDeleteMessages(userId, [messageId], transport);
    },

    async markRead({ userId, messageId, read }) {
      await gmailSetRead(userId, [messageId], read, transport);
    },

    async setStarred({ userId, messageId, starred }) {
      await gmailSetStarred(userId, [messageId], starred, transport);
    },

    async addLabel({ userId, messageId, label }) {
      await gmailApplyLabel(userId, [messageId], label, transport);
    },

    async removeLabel({ userId, messageId, label }) {
      await gmailRemoveLabel(userId, [messageId], label, transport);
    },
  };
}

export const gmailEmailProvider = createGmailEmailProvider();

export { isUnreachable };
