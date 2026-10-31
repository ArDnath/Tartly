import "server-only";

import { AuthorizationError, NotFoundError } from "@/lib/agent/errors";
import { isUnreachable } from "@/lib/mail/service";
import type { MailDraft, MailMessage } from "@/lib/mail/service";
import {
  defaultOutlookTransport,
  isOutlookConnected,
  OutlookApiError,
  OutlookAuthError,
  type OutlookTransport,
} from "@/lib/outlook/client";
import {
  addOutlookLabel,
  deleteOutlookMessages,
  getOutlookDraft,
  getOutlookMessage,
  getOutlookThread,
  listOutlookDrafts,
  listOutlookMessages,
  removeOutlookLabel,
  saveOutlookDraft,
  setOutlookArchived,
  setOutlookRead,
  setOutlookStarred,
  setOutlookTrashed,
  updateOutlookDraft,
  type OutlookOutgoingMail,
} from "@/lib/outlook/service";

import type {
  EmailCorrespondent,
  EmailDetail,
  EmailDraft,
  EmailDraftInput,
  EmailSummary,
  FullEmailProvider,
  SearchMessagesResult,
} from "./types";

/**
 * Outlook adapter for the `EmailProvider` contract.
 *
 * The Gmail adapter was already written against that contract, so the AI layer
 * (assistant tools, drafting, contact lookup) can now work on Outlook without a
 * single tool knowing which provider answered. Ids are prefixed by the unified
 * provider above this one.
 */

function toSummary(message: MailMessage): EmailSummary {
  const outgoing = message.box === "sent" || message.box === "drafts";
  return {
    id: message.id,
    threadId: message.threadId || message.id,
    provider: "outlook",
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

function toOutgoing(draft: EmailDraftInput): OutlookOutgoingMail {
  return {
    to: draft.to,
    ...(draft.cc.length ? { cc: draft.cc } : {}),
    ...(draft.bcc.length ? { bcc: draft.bcc } : {}),
    subject: draft.subject,
    body: draft.body,
  };
}

function mapError(error: unknown): never {
  if (error instanceof OutlookApiError && error.status === 404) {
    throw new NotFoundError("That email or draft could not be found.");
  }
  if (error instanceof OutlookAuthError) {
    throw new AuthorizationError(
      "Outlook access was revoked. Reconnect your account and try again.",
    );
  }
  throw error;
}

/** Observed correspondents from recent inbox and sent mail. */
async function listCorrespondents(
  userId: string,
  limit: number,
  transport: OutlookTransport,
): Promise<EmailCorrespondent[]> {
  const [inbox, sent] = await Promise.all([
    listOutlookMessages(userId, { box: "inbox", limit: 100 }, transport).catch(
      () => ({ messages: [] as MailMessage[] }),
    ),
    listOutlookMessages(userId, { box: "sent", limit: 100 }, transport).catch(
      () => ({ messages: [] as MailMessage[] }),
    ),
  ]);

  const self = new Set(
    [...inbox.messages, ...sent.messages]
      .filter((message) => message.box === "sent")
      .map((message) => message.from.email.toLowerCase()),
  );
  const directory = new Map<string, EmailCorrespondent>();

  const record = (
    address: { name: string; email: string },
    direction: "sent" | "received",
    at: string,
  ) => {
    const email = address.email.trim().toLowerCase();
    if (!email || !email.includes("@") || self.has(email)) return;
    if (isUnreachable(email)) return;
    const existing = directory.get(email);
    if (!existing) {
      directory.set(email, {
        email,
        name: address.name || email.split("@")[0]!,
        sent: direction === "sent" ? 1 : 0,
        received: direction === "received" ? 1 : 0,
        lastSeen: at,
      });
      return;
    }
    existing[direction] += 1;
    if (at > existing.lastSeen) existing.lastSeen = at;
  };

  for (const message of inbox.messages) {
    record(message.from, "received", message.receivedAt);
    for (const address of [...message.to, ...(message.cc ?? [])]) {
      record(address, "received", message.receivedAt);
    }
  }
  for (const message of sent.messages) {
    for (const address of [...message.to, ...(message.cc ?? [])]) {
      record(address, "sent", message.receivedAt);
    }
  }

  return [...directory.values()]
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, Math.min(Math.max(limit, 1), 2000));
}

export function createOutlookEmailProvider(
  transport: OutlookTransport = defaultOutlookTransport,
): FullEmailProvider {
  return {
    kind: "outlook",

    async isConnected(userId) {
      return isOutlookConnected(userId);
    },

    async searchMessages({
      userId,
      query,
      box,
      limit,
      pageToken,
    }): Promise<SearchMessagesResult> {
      const page = await listOutlookMessages(
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
      try {
        return toDetail(await getOutlookMessage(userId, messageId, transport));
      } catch (error) {
        return mapError(error);
      }
    },

    async getThread({ userId, threadId }) {
      const thread = await getOutlookThread(userId, threadId, transport);
      return {
        id: thread.id,
        subject: thread.subject,
        messages: thread.messages.map(toDetail),
      };
    },

    async listCorrespondents({ userId, limit }) {
      return listCorrespondents(userId, limit ?? 500, transport);
    },

    async getDraft({ userId, draftId }) {
      try {
        return toDraft(await getOutlookDraft(userId, draftId, transport));
      } catch (error) {
        return mapError(error);
      }
    },

    async listDrafts({ userId, limit }) {
      return (await listOutlookDrafts(userId, limit, transport)).map(toDraft);
    },

    async createDraft({ userId, draft }) {
      return toDraft(
        await saveOutlookDraft(
          userId,
          {
            to: draft.to,
            ...(draft.cc.length ? { cc: draft.cc } : {}),
            ...(draft.bcc.length ? { bcc: draft.bcc } : {}),
            subject: draft.subject,
            body: draft.body,
            ...(draft.threadId ? { threadId: draft.threadId } : {}),
          },
          transport,
        ),
      );
    },

    async updateDraft({ userId, draftId, draft }) {
      try {
        return toDraft(
          await updateOutlookDraft(
            userId,
            draftId,
            toOutgoing(draft),
            transport,
          ),
        );
      } catch (error) {
        return mapError(error);
      }
    },

    async archiveMessage({ userId, messageId }) {
      await setOutlookArchived(userId, [messageId], true, transport);
    },

    async trashMessage({ userId, messageId }) {
      await setOutlookTrashed(userId, [messageId], true, transport);
    },

    async untrashMessage({ userId, messageId }) {
      await setOutlookTrashed(userId, [messageId], false, transport);
    },

    async deleteMessage({ userId, messageId }) {
      await deleteOutlookMessages(userId, [messageId], transport);
    },

    async markRead({ userId, messageId, read }) {
      await setOutlookRead(userId, [messageId], read, transport);
    },

    async setStarred({ userId, messageId, starred }) {
      await setOutlookStarred(userId, [messageId], starred, transport);
    },

    async addLabel({ userId, messageId, label }) {
      await addOutlookLabel(userId, [messageId], label, transport);
    },

    async removeLabel({ userId, messageId, label }) {
      await removeOutlookLabel(userId, [messageId], label, transport);
    },
  };
}

export const outlookEmailProvider = createOutlookEmailProvider();
