import "server-only";

import {
  AuthenticationError,
  ConflictError,
  ValidationError,
} from "@/lib/agent/errors";
import { gmailEmailProvider } from "@/lib/providers/email/gmail-provider";
import type {
  EmailDraft,
  EmailDraftInput,
  EmailDraftProvider,
} from "@/lib/providers/email/types";

/**
 * DraftService — business rules for draft creation and editing.
 *
 * Gmail's `drafts.update` replaces the whole inner message, so an edit is a
 * read-merge-write. This service owns that merge, the input bounds, and the
 * optimistic-concurrency check: the caller passes the `version` it last saw and
 * a newer revision is rejected with `ConflictError` rather than overwritten.
 *
 * Like every service it is scoped to an authenticated user id and never trusts
 * a caller-supplied identity.
 */

export const MAX_DRAFT_BODY_CHARS = 20_000;
export const MAX_DRAFT_SUBJECT_CHARS = 500;
export const MAX_DRAFT_RECIPIENTS = 20;
export const MAX_IN_REPLY_TO_CHARS = 998;
export const MAX_DRAFT_ID_CHARS = 256;

/** Pragmatic address check: one `@`, a dot in the domain, no whitespace. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalize a recipient that may be either a bare address or an RFC 5322
 * `Name <address>` form (the shape the read tools emit). Returns the lowercased
 * address, or `null` when it is not a valid address.
 */
export function extractEmail(value: string): string | null {
  const trimmed = value.trim();
  const angled = trimmed.match(/<([^>]+)>/);
  const candidate = (angled ? angled[1]! : trimmed).trim().toLowerCase();
  return EMAIL_PATTERN.test(candidate) ? candidate : null;
}

export interface DraftPatch {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  threadId?: string;
  inReplyTo?: string;
}

export class DraftService {
  constructor(
    private readonly provider: EmailDraftProvider = gmailEmailProvider,
  ) {}

  async getDraft(input: {
    userId: string;
    draftId: string;
  }): Promise<EmailDraft> {
    const userId = this.requireUser(input.userId);
    return this.provider.getDraft({ userId, draftId: this.requireDraftId(input.draftId) });
  }

  async listDrafts(input: {
    userId: string;
    limit?: number;
  }): Promise<EmailDraft[]> {
    const userId = this.requireUser(input.userId);
    return this.provider.listDrafts({ userId, limit: input.limit });
  }

  async createDraft(input: {
    userId: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    body: string;
    threadId?: string;
    inReplyTo?: string;
  }): Promise<EmailDraft> {
    const userId = this.requireUser(input.userId);

    const draft: EmailDraftInput = {
      to: this.normalizeAddresses(input.to, "to"),
      cc: this.normalizeAddresses(input.cc ?? [], "cc"),
      bcc: this.normalizeAddresses(input.bcc ?? [], "bcc"),
      subject: this.normalizeSubject(input.subject ?? ""),
      body: this.normalizeBody(input.body),
      ...(input.threadId ? { threadId: input.threadId.trim() } : {}),
      ...(input.inReplyTo
        ? { inReplyTo: input.inReplyTo.trim().slice(0, MAX_IN_REPLY_TO_CHARS) }
        : {}),
    };

    return this.provider.createDraft({ userId, draft });
  }

  /**
   * Read-merge-write an edit. When `expectedVersion` is supplied and does not
   * match the current draft, the write is refused before it reaches the
   * provider — a stale editor can never clobber a newer revision.
   */
  async updateDraft(input: {
    userId: string;
    draftId: string;
    expectedVersion?: string;
    patch: DraftPatch;
  }): Promise<EmailDraft> {
    const userId = this.requireUser(input.userId);
    const draftId = this.requireDraftId(input.draftId);

    const current = await this.provider.getDraft({ userId, draftId });
    if (input.expectedVersion && input.expectedVersion !== current.version) {
      throw new ConflictError(
        "This draft changed since you read it. Reopen it and try again.",
      );
    }

    const patch = input.patch;
    const merged: EmailDraftInput = {
      to: patch.to !== undefined ? this.normalizeAddresses(patch.to, "to") : current.to,
      cc: patch.cc !== undefined ? this.normalizeAddresses(patch.cc, "cc") : current.cc,
      bcc:
        patch.bcc !== undefined
          ? this.normalizeAddresses(patch.bcc, "bcc")
          : current.bcc,
      subject:
        patch.subject !== undefined
          ? this.normalizeSubject(patch.subject)
          : current.subject,
      body: patch.body !== undefined ? this.normalizeBody(patch.body) : current.body,
      ...this.replyFields(patch, current),
    };

    return this.provider.updateDraft({ userId, draftId, draft: merged });
  }

  private replyFields(
    patch: DraftPatch,
    current: EmailDraft,
  ): { threadId?: string; inReplyTo?: string } {
    const threadId = patch.threadId ?? current.threadId;
    const inReplyTo = patch.inReplyTo ?? current.inReplyTo;
    return {
      ...(threadId ? { threadId } : {}),
      ...(inReplyTo
        ? { inReplyTo: inReplyTo.trim().slice(0, MAX_IN_REPLY_TO_CHARS) }
        : {}),
    };
  }

  private requireUser(userId: string): string {
    if (!userId) throw new AuthenticationError();
    return userId;
  }

  private requireDraftId(draftId: string): string {
    const id = draftId?.trim();
    if (!id) throw new ValidationError("draftId is required.");
    if (id.length > MAX_DRAFT_ID_CHARS) {
      throw new ValidationError("That draft id is not valid.");
    }
    return id;
  }

  private normalizeAddresses(addresses: string[], field: string): string[] {
    const normalized: string[] = [];
    for (const raw of addresses) {
      const email = extractEmail(raw);
      if (!email) {
        throw new ValidationError(`"${raw}" is not a valid email address.`);
      }
      if (!normalized.includes(email)) normalized.push(email);
    }

    if (normalized.length > MAX_DRAFT_RECIPIENTS) {
      throw new ValidationError(
        `A draft can have at most ${MAX_DRAFT_RECIPIENTS} ${field} recipients.`,
      );
    }
    return normalized;
  }

  private normalizeSubject(subject: string): string {
    return subject.trim().slice(0, MAX_DRAFT_SUBJECT_CHARS);
  }

  private normalizeBody(body: string): string {
    if (!body.trim()) throw new ValidationError("A draft needs a body.");
    if (body.length > MAX_DRAFT_BODY_CHARS) {
      throw new ValidationError(
        `A draft body is limited to ${MAX_DRAFT_BODY_CHARS} characters.`,
      );
    }
    return body;
  }
}

export const draftService = new DraftService();
