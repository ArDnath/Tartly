import "server-only";

import { AuthenticationError, ValidationError } from "@/lib/agent/errors";
import { unifiedEmailProvider } from "@/lib/providers/email/unified-provider";
import type {
  EmailDetail,
  EmailMailboxProvider,
  EmailThread,
  SearchMessagesInput,
  SearchMessagesResult,
} from "@/lib/providers/email/types";

/**
 * EmailService — business rules over the email provider.
 *
 * Tools only ever call this. It enforces the invariants that must hold no
 * matter which provider is plugged in:
 *   - every call is scoped to an authenticated user id;
 *   - result sizes are bounded (context and cost control);
 *   - nothing here trusts a caller-supplied identity.
 *
 * Reads and reversible mailbox mutations live here; drafting has its own
 * service (`lib/services/draft-service.ts`) because it carries reply-threading
 * and concurrency rules.
 */

export const MAX_EMAIL_RESULTS = 25;
export const DEFAULT_EMAIL_RESULTS = 10;
export const MAX_LABEL_NAME_CHARS = 100;

export class EmailService {
  constructor(
    private readonly provider: EmailMailboxProvider = unifiedEmailProvider,
  ) {}

  get kind() {
    return this.provider.kind;
  }

  isConnected(userId: string): Promise<boolean> {
    return this.provider.isConnected(userId);
  }

  async searchMessages(
    input: SearchMessagesInput,
  ): Promise<SearchMessagesResult> {
    if (!input.userId) throw new AuthenticationError();

    const requested = input.limit ?? DEFAULT_EMAIL_RESULTS;
    if (requested < 1) throw new ValidationError("limit must be positive.");
    const limit = Math.min(requested, MAX_EMAIL_RESULTS);
    const query = input.query?.trim().slice(0, 512) || undefined;

    return this.provider.searchMessages({
      userId: input.userId,
      ...(query ? { query } : {}),
      ...(input.box ? { box: input.box } : {}),
      limit,
      ...(input.pageToken ? { pageToken: input.pageToken } : {}),
    });
  }

  async getMessage(input: {
    userId: string;
    messageId: string;
  }): Promise<EmailDetail> {
    if (!input.userId) throw new AuthenticationError();
    if (!input.messageId) throw new ValidationError("messageId is required.");
    return this.provider.getMessage(input);
  }

  async getThread(input: {
    userId: string;
    threadId: string;
  }): Promise<EmailThread> {
    if (!input.userId) throw new AuthenticationError();
    if (!input.threadId) throw new ValidationError("threadId is required.");
    return this.provider.getThread(input);
  }

  /* ---------------------------------------------------------------------- */
  /*  Reversible mailbox mutations                                          */
  /* ---------------------------------------------------------------------- */

  async archiveMessage(input: {
    userId: string;
    messageId: string;
  }): Promise<void> {
    const { userId, messageId } = this.requireMailboxTarget(input);
    await this.provider.archiveMessage({ userId, messageId });
  }

  /**
   * Move a message to the trash. Reversible; the agent never performs an
   * irreversible delete. This is a side effect outside the mailbox's own
   * labels, so callers route it through the confirmation subsystem.
   */
  async trashMessage(input: {
    userId: string;
    messageId: string;
  }): Promise<void> {
    const { userId, messageId } = this.requireMailboxTarget(input);
    await this.provider.trashMessage({ userId, messageId });
  }

  /** Restore a message from the trash. */
  async untrashMessage(input: {
    userId: string;
    messageId: string;
  }): Promise<void> {
    const { userId, messageId } = this.requireMailboxTarget(input);
    await this.provider.untrashMessage({ userId, messageId });
  }

  /**
   * Permanently delete a message, bypassing the trash. Irreversible, and on
   * Gmail it needs the full-mailbox scope. Callers must gate this behind an
   * explicit confirmation.
   */
  async deleteMessageForever(input: {
    userId: string;
    messageId: string;
  }): Promise<void> {
    const { userId, messageId } = this.requireMailboxTarget(input);
    await this.provider.deleteMessage({ userId, messageId });
  }

  async markRead(input: {
    userId: string;
    messageId: string;
    read: boolean;
  }): Promise<void> {
    const { userId, messageId } = this.requireMailboxTarget(input);
    await this.provider.markRead({ userId, messageId, read: input.read });
  }

  /**
   * Star or unstar a message. Reversible (Gmail's STARRED label), so it runs
   * without confirmation like the other mailbox mutations here.
   */
  async starMessage(input: {
    userId: string;
    messageId: string;
    starred: boolean;
  }): Promise<void> {
    const { userId, messageId } = this.requireMailboxTarget(input);
    await this.provider.setStarred({
      userId,
      messageId,
      starred: input.starred,
    });
  }

  async addLabel(input: {
    userId: string;
    messageId: string;
    label: string;
  }): Promise<void> {
    const { userId, messageId } = this.requireMailboxTarget(input);
    await this.provider.addLabel({
      userId,
      messageId,
      label: this.normalizeLabel(input.label),
    });
  }

  async removeLabel(input: {
    userId: string;
    messageId: string;
    label: string;
  }): Promise<void> {
    const { userId, messageId } = this.requireMailboxTarget(input);
    await this.provider.removeLabel({
      userId,
      messageId,
      label: this.normalizeLabel(input.label),
    });
  }

  private requireMailboxTarget(input: {
    userId: string;
    messageId: string;
  }): { userId: string; messageId: string } {
    if (!input.userId) throw new AuthenticationError();
    const messageId = input.messageId?.trim();
    if (!messageId) throw new ValidationError("messageId is required.");
    return { userId: input.userId, messageId };
  }

  private normalizeLabel(label: string): string {
    const name = label?.trim();
    if (!name) throw new ValidationError("label is required.");
    if (name.length > MAX_LABEL_NAME_CHARS) {
      throw new ValidationError(
        `Label names are limited to ${MAX_LABEL_NAME_CHARS} characters.`,
      );
    }
    return name;
  }
}

export const emailService = new EmailService();
