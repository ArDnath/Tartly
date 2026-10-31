import "server-only";

import { connectedMailProviders } from "@/lib/mail/accounts";

import { createGmailEmailProvider } from "./gmail-provider";
import { createOutlookEmailProvider } from "./outlook-provider";
import type {
  EmailCorrespondent,
  EmailDraft,
  FullEmailProvider,
  SearchMessagesInput,
  SearchMessagesResult,
} from "./types";

/**
 * The shared-inbox provider the AI layer talks to.
 *
 * Gmail and Outlook are both live sources of truth. Reads are merged (newest
 * first) and every write is routed by the id's namespace: Outlook ids carry an
 * `outlook:` prefix, Gmail ids are untouched. That is the same convention the
 * mail client uses, so an id produced by `search_emails` can be passed straight
 * to `get_email`, `reply_to_email` or `archive_email` and land in the right
 * mailbox.
 */

const OUTLOOK_PREFIX = "outlook:";

function isOutlookId(id: string): boolean {
  return id.startsWith(OUTLOOK_PREFIX);
}

function stripOutlookId(id: string): string {
  return id.slice(OUTLOOK_PREFIX.length);
}

function tag(message: { id: string; threadId: string }, provider: "outlook") {
  return {
    id: `${OUTLOOK_PREFIX}${message.id}`,
    threadId: `${OUTLOOK_PREFIX}${message.threadId}`,
    provider,
  };
}

function tagDraft(draft: EmailDraft): EmailDraft {
  return {
    ...draft,
    id: `${OUTLOOK_PREFIX}${draft.id}`,
    ...(draft.threadId
      ? { threadId: `${OUTLOOK_PREFIX}${draft.threadId}` }
      : {}),
  };
}

async function providerIds(userId: string): Promise<Array<"gmail" | "outlook">> {
  const connected = await connectedMailProviders(userId);
  return connected.map((provider) =>
    provider === "microsoft" ? "outlook" : "gmail",
  );
}

function mergeCorrespondents(
  lists: EmailCorrespondent[][],
): EmailCorrespondent[] {
  const merged = new Map<string, EmailCorrespondent>();
  for (const list of lists) {
    for (const correspondent of list) {
      const email = correspondent.email.toLowerCase();
      const existing = merged.get(email);
      if (!existing) {
        merged.set(email, { ...correspondent, email });
        continue;
      }
      existing.sent += correspondent.sent;
      existing.received += correspondent.received;
      if (correspondent.lastSeen > existing.lastSeen) {
        existing.lastSeen = correspondent.lastSeen;
      }
      if (
        correspondent.name &&
        existing.name === existing.email.split("@")[0]
      ) {
        existing.name = correspondent.name;
      }
    }
  }
  return [...merged.values()].sort((a, b) =>
    b.lastSeen.localeCompare(a.lastSeen),
  );
}

export function createUnifiedEmailProvider(
  options: {
    gmail?: FullEmailProvider;
    outlook?: FullEmailProvider;
  } = {},
): FullEmailProvider {
  const gmail = options.gmail ?? createGmailEmailProvider();
  const outlook = options.outlook ?? createOutlookEmailProvider();

  return {
    kind: "unified",

    async isConnected(userId) {
      return (await providerIds(userId)).length > 0;
    },

    async searchMessages(input: SearchMessagesInput): Promise<SearchMessagesResult> {
      const active = await providerIds(input.userId);
      const providers = active.map((kind) =>
        kind === "outlook" ? outlook : gmail,
      );
      if (providers.length === 0) {
        return gmail.searchMessages(input);
      }

      const results = await Promise.all(
        providers.map((provider) =>
          provider.searchMessages(input).then(
            (value) => ({ ok: true as const, provider, value }),
            (error) => ({ ok: false as const, provider, error }),
          ),
        ),
      );
      const succeeded = results.filter(
        (result): result is { ok: true; provider: FullEmailProvider; value: SearchMessagesResult } =>
          result.ok,
      );
      if (succeeded.length === 0) {
        const first = results.find((result) => !result.ok);
        if (first && !first.ok && first.error instanceof Error) throw first.error;
        throw new Error("No connected mail account responded.");
      }

      const merged = succeeded
        .flatMap(({ provider, value }) =>
          value.messages.map((message) =>
            provider.kind === "outlook"
              ? { ...message, ...tag(message, "outlook") }
              : { ...message, provider: "gmail" as const },
          ),
        )
        .sort(
          (a, b) =>
            new Date(b.receivedAt).getTime() -
            new Date(a.receivedAt).getTime(),
        )
        .slice(0, input.limit ?? 10);

      return {
        messages: merged,
        ...(succeeded.length === 1 &&
        succeeded[0]!.value.nextPageToken
          ? { nextPageToken: succeeded[0]!.value.nextPageToken }
          : {}),
      };
    },

    async getMessage({ userId, messageId }) {
      if (isOutlookId(messageId)) {
        const message = await outlook.getMessage({
          userId,
          messageId: stripOutlookId(messageId),
        });
        return { ...message, ...tag(message, "outlook") };
      }
      return gmail.getMessage({ userId, messageId });
    },

    async getThread({ userId, threadId }) {
      if (isOutlookId(threadId)) {
        const thread = await outlook.getThread({
          userId,
          threadId: stripOutlookId(threadId),
        });
        return {
          ...thread,
          id: `${OUTLOOK_PREFIX}${thread.id}`,
          messages: thread.messages.map((message) => ({
            ...message,
            ...tag(message, "outlook"),
          })),
        };
      }
      return gmail.getThread({ userId, threadId });
    },

    async listCorrespondents({ userId, limit }) {
      const active = await providerIds(userId);
      if (active.length === 0) {
        return gmail.listCorrespondents({ userId, limit });
      }
      const lists = await Promise.all(
        active.map((kind) =>
          (kind === "outlook" ? outlook : gmail)
            .listCorrespondents({ userId, limit })
            .catch(() => []),
        ),
      );
      return mergeCorrespondents(lists).slice(0, limit ?? 500);
    },

    async getDraft({ userId, draftId }) {
      if (isOutlookId(draftId)) {
        return tagDraft(
          await outlook.getDraft({
            userId,
            draftId: stripOutlookId(draftId),
          }),
        );
      }
      return gmail.getDraft({ userId, draftId });
    },

    async listDrafts({ userId, limit }) {
      const active = await providerIds(userId);
      const drafts: EmailDraft[] = [];
      if (active.includes("gmail")) {
        drafts.push(...(await gmail.listDrafts({ userId, limit })));
      }
      if (active.includes("outlook")) {
        drafts.push(
          ...(await outlook.listDrafts({ userId, limit })).map(tagDraft),
        );
      }
      return drafts
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit ?? 10);
    },

    async createDraft({ userId, draft }) {
      const active = await providerIds(userId);
      const wantsOutlook =
        draft.account === "outlook" ||
        Boolean(draft.threadId && isOutlookId(draft.threadId)) ||
        (!active.includes("gmail") && active.includes("outlook"));
      if (wantsOutlook) {
        const threadId = draft.threadId
          ? stripOutlookId(draft.threadId)
          : undefined;
        return tagDraft(
          await outlook.createDraft({
            userId,
            draft: { ...draft, ...(threadId ? { threadId } : {}) },
          }),
        );
      }
      return gmail.createDraft({ userId, draft });
    },

    async updateDraft({ userId, draftId, draft }) {
      if (isOutlookId(draftId)) {
        return tagDraft(
          await outlook.updateDraft({
            userId,
            draftId: stripOutlookId(draftId),
            draft,
          }),
        );
      }
      return gmail.updateDraft({ userId, draftId, draft });
    },

    async archiveMessage({ userId, messageId }) {
      if (isOutlookId(messageId)) {
        return outlook.archiveMessage({
          userId,
          messageId: stripOutlookId(messageId),
        });
      }
      return gmail.archiveMessage({ userId, messageId });
    },

    async trashMessage({ userId, messageId }) {
      if (isOutlookId(messageId)) {
        return outlook.trashMessage({
          userId,
          messageId: stripOutlookId(messageId),
        });
      }
      return gmail.trashMessage({ userId, messageId });
    },

    async untrashMessage({ userId, messageId }) {
      if (isOutlookId(messageId)) {
        return outlook.untrashMessage({
          userId,
          messageId: stripOutlookId(messageId),
        });
      }
      return gmail.untrashMessage({ userId, messageId });
    },

    async deleteMessage({ userId, messageId }) {
      if (isOutlookId(messageId)) {
        return outlook.deleteMessage({
          userId,
          messageId: stripOutlookId(messageId),
        });
      }
      return gmail.deleteMessage({ userId, messageId });
    },

    async markRead({ userId, messageId, read }) {
      if (isOutlookId(messageId)) {
        return outlook.markRead({
          userId,
          messageId: stripOutlookId(messageId),
          read,
        });
      }
      return gmail.markRead({ userId, messageId, read });
    },

    async setStarred({ userId, messageId, starred }) {
      if (isOutlookId(messageId)) {
        return outlook.setStarred({
          userId,
          messageId: stripOutlookId(messageId),
          starred,
        });
      }
      return gmail.setStarred({ userId, messageId, starred });
    },

    async addLabel({ userId, messageId, label }) {
      if (isOutlookId(messageId)) {
        return outlook.addLabel({
          userId,
          messageId: stripOutlookId(messageId),
          label,
        });
      }
      return gmail.addLabel({ userId, messageId, label });
    },

    async removeLabel({ userId, messageId, label }) {
      if (isOutlookId(messageId)) {
        return outlook.removeLabel({
          userId,
          messageId: stripOutlookId(messageId),
          label,
        });
      }
      return gmail.removeLabel({ userId, messageId, label });
    },
  };
}

export const unifiedEmailProvider = createUnifiedEmailProvider();

export { isOutlookId, stripOutlookId };
