import "server-only";

import {
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  ValidationError,
} from "@/lib/agent/errors";
import { sendEmail } from "@/lib/gmail/send";
import {
  buildHtmlWithImages,
  resolveOutboundAssets,
} from "@/lib/assets/outbound";
import { connectedMailProviders } from "@/lib/mail/accounts";
import { allowMailSend } from "@/lib/mail/rate-limit";
import { profile } from "@/lib/mail/service";
import { sendOutlookEmail } from "@/lib/outlook/send";
import { unifiedEmailProvider } from "@/lib/providers/email/unified-provider";
import type { EmailDetail, EmailProvider } from "@/lib/providers/email/types";
import {
  extractEmail,
  MAX_DRAFT_BODY_CHARS,
  MAX_DRAFT_RECIPIENTS,
  MAX_DRAFT_SUBJECT_CHARS,
} from "@/lib/services/draft-service";

/**
 * SendService — the business rules for outbound mail.
 *
 * This is the only application-layer path to `lib/gmail/send.ts`, which is in
 * turn the only code that calls `messages/send`. Every rule that must hold no
 * matter which caller arrives lives here:
 *   - the sender (`from`) is resolved from the authenticated account, never
 *     supplied by the caller or the model;
 *   - recipients are normalized, de-duplicated and capped;
 *   - a send requires a server-derived idempotency key, so a message can only be
 *     sent by a confirmed pending action;
 *   - the per-user send throttle is enforced before the provider is touched.
 */

export const MAX_SEND_RECIPIENTS = MAX_DRAFT_RECIPIENTS;
export const MAX_SEND_SUBJECT_CHARS = MAX_DRAFT_SUBJECT_CHARS;
export const MAX_SEND_BODY_CHARS = MAX_DRAFT_BODY_CHARS;

export interface SendResult {
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  /** Which mailbox produced the message. */
  provider: "gmail" | "outlook";
  /** True when the ledger had already accepted this key — nothing was sent. */
  deduped: boolean;
  to: string[];
  subject: string;
}

export interface SendServiceOptions {
  /** Read side, used to resolve the original message for reply/forward. */
  provider?: Pick<EmailProvider, "getMessage">;
  /** The single outbound path (injectable so tests never touch Google). */
  send?: typeof sendEmail;
  /** Outlook outbound path (injectable so tests never touch Graph). */
  sendOutlook?: typeof sendOutlookEmail;
  /** The signed-in mailbox address. */
  getProfile?: (userId: string) => Promise<{ emailAddress: string }>;
  /** Which mailboxes are connected; determines the default sender. */
  getProviders?: (userId: string) => Promise<Array<"google" | "microsoft">>;
  /** Per-user send throttle. */
  allowSend?: (userId: string) => Promise<boolean>;
}

export class SendService {
  private readonly provider: Pick<EmailProvider, "getMessage">;
  private readonly send: typeof sendEmail;
  private readonly sendOutlook: typeof sendOutlookEmail;
  private readonly getProfile: (userId: string) => Promise<{ emailAddress: string }>;
  private readonly getProviders: (
    userId: string,
  ) => Promise<Array<"google" | "microsoft">>;
  private readonly allowSend: (userId: string) => Promise<boolean>;

  constructor(options: SendServiceOptions = {}) {
    this.provider = options.provider ?? unifiedEmailProvider;
    this.send = options.send ?? sendEmail;
    this.sendOutlook = options.sendOutlook ?? sendOutlookEmail;
    this.getProfile = options.getProfile ?? profile;
    // Tests inject a fake Gmail send path and no directory; treat that as a
    // single connected Gmail account rather than querying the database.
    this.getProviders =
      options.getProviders ??
      (options.send
        ? async () => ["google"] as Array<"google" | "microsoft">
        : connectedMailProviders);
    this.allowSend = options.allowSend ?? allowMailSend;
  }

  async sendMessage(input: {
    userId: string;
    idempotencyKey?: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    body: string;
    /** Which connected account to send from; defaults to Gmail if live. */
    account?: "gmail" | "outlook";
    /** Phase 6: asset ids attached, and images rendered inline. */
    assetIds?: string[];
    inlineImageIds?: string[];
  }): Promise<SendResult> {
    const userId = this.requireUser(input.userId);
    const idempotencyKey = this.requireConfirmedAction(input.idempotencyKey);
    const to = this.normalizeAddresses(input.to, "to", true);
    const cc = this.normalizeAddresses(input.cc ?? [], "cc");
    const bcc = this.normalizeAddresses(input.bcc ?? [], "bcc");
    const subject = this.normalizeSubject(input.subject ?? "");
    const body = this.normalizeBody(input.body);

    return this.dispatch({
      userId,
      idempotencyKey,
      to,
      cc,
      bcc,
      subject,
      body,
      ...(input.account ? { account: input.account } : {}),
      ...(input.assetIds?.length ? { assetIds: input.assetIds } : {}),
      ...(input.inlineImageIds?.length
        ? { inlineImageIds: input.inlineImageIds }
        : {}),
    });
  }

  async replyToMessage(input: {
    userId: string;
    idempotencyKey?: string;
    messageId: string;
    body: string;
  }): Promise<SendResult> {
    const userId = this.requireUser(input.userId);
    const idempotencyKey = this.requireConfirmedAction(input.idempotencyKey);
    const original = await this.loadOriginal(userId, input.messageId);
    const body = this.normalizeBody(input.body);

    const to = this.normalizeAddresses([original.from.email], "to", true);
    const subject = /^re:/i.test(original.subject.trim())
      ? original.subject.trim()
      : `Re: ${this.normalizeSubject(original.subject)}`;

    return this.dispatch({
      userId,
      idempotencyKey,
      to,
      cc: [],
      bcc: [],
      subject,
      body,
      threadId: original.threadId,
      ...(original.provider ? { account: original.provider } : {}),
      ...(original.inReplyTo ? { inReplyTo: original.inReplyTo } : {}),
    });
  }

  async forwardMessage(input: {
    userId: string;
    idempotencyKey?: string;
    messageId: string;
    to: string[];
    cc?: string[];
    body?: string;
  }): Promise<SendResult> {
    const userId = this.requireUser(input.userId);
    const idempotencyKey = this.requireConfirmedAction(input.idempotencyKey);
    const original = await this.loadOriginal(userId, input.messageId);
    const to = this.normalizeAddresses(input.to, "to", true);
    const cc = this.normalizeAddresses(input.cc ?? [], "cc");

    const subject = /^fwd:/i.test(original.subject.trim())
      ? original.subject.trim()
      : `Fwd: ${this.normalizeSubject(original.subject)}`;
    const note = input.body?.trim();
    const body = this.normalizeBody(
      [
        ...(note ? [`${note}\n`] : []),
        "---------- Forwarded message ----------",
        `From: ${original.from.name || original.from.email} <${original.from.email}>`,
        `Subject: ${original.subject}`,
        `Date: ${original.receivedAt}`,
        "",
        original.bodyText,
      ].join("\n"),
    );

    return this.dispatch({
      userId,
      idempotencyKey,
      to,
      cc,
      bcc: [],
      subject,
      body,
      ...(original.provider ? { account: original.provider } : {}),
    });
  }

  private async dispatch(input: {
    userId: string;
    idempotencyKey: string;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    body: string;
    threadId?: string;
    account?: "gmail" | "outlook";
    inReplyTo?: string;
    assetIds?: string[];
    inlineImageIds?: string[];
  }): Promise<SendResult> {
    if (!(await this.allowSend(input.userId))) {
      throw new RateLimitError(
        "You're sending mail too quickly. Wait a moment and try again.",
      );
    }

    const providers = await this.getProviders(input.userId);
    const target: "gmail" | "outlook" =
      input.account ??
      (providers.includes("google") || !providers.includes("microsoft")
        ? "gmail"
        : "outlook");

    if (target === "gmail" && !providers.includes("google")) {
      throw new AuthorizationError(
        "Your Google account is not connected. Reconnect it and try again.",
      );
    }
    if (target === "outlook" && !providers.includes("microsoft")) {
      throw new AuthorizationError(
        "Your Outlook account is not connected. Reconnect it and try again.",
      );
    }

    // Phase 6: resolve assets to bytes at send time so delivered mail is durable.
    const assets =
      input.assetIds?.length || input.inlineImageIds?.length
        ? await resolveOutboundAssets({
            userId: input.userId,
            inlineImageIds: input.inlineImageIds ?? [],
            attachmentIds: input.assetIds ?? [],
          })
        : null;
    const html = assets ? buildHtmlWithImages(input.body, assets.htmlImages) : null;

    if (target === "outlook") {
      const result = await this.sendOutlook({
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        email: {
          from: "",
          to: input.to,
          ...(input.cc.length ? { cc: input.cc } : {}),
          ...(input.bcc.length ? { bcc: input.bcc } : {}),
          subject: input.subject,
          text: input.body,
          ...(html ? { html } : {}),
          ...(assets?.inlineImages.length
            ? { inlineImages: assets.inlineImages }
            : {}),
          ...(assets?.attachments.length
            ? { attachments: assets.attachments }
            : {}),
          ...(input.inReplyTo
            ? { inReplyTo: input.inReplyTo, references: [input.inReplyTo] }
            : {}),
        },
      });
      return {
        gmailMessageId: result.outlookMessageId,
        gmailThreadId: null,
        provider: "outlook",
        deduped: result.deduped,
        to: input.to,
        subject: input.subject,
      };
    }

    const account = await this.getProfile(input.userId);
    if (!account.emailAddress) {
      throw new AuthorizationError(
        "Your Google account is not connected. Reconnect it and try again.",
      );
    }

    const result = await this.send({
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      ...(input.threadId ? { gmailThreadId: input.threadId } : {}),
      email: {
        from: account.emailAddress,
        to: input.to,
        ...(input.cc.length ? { cc: input.cc } : {}),
        ...(input.bcc.length ? { bcc: input.bcc } : {}),
        subject: input.subject,
        text: input.body,
        ...(html ? { html } : {}),
        ...(assets?.inlineImages.length
          ? { inlineImages: assets.inlineImages }
          : {}),
        ...(assets?.attachments.length
          ? { attachments: assets.attachments }
          : {}),
        ...(input.inReplyTo
          ? { inReplyTo: input.inReplyTo, references: [input.inReplyTo] }
          : {}),
      },
    });

    return {
      gmailMessageId: result.gmailMessageId,
      gmailThreadId: result.gmailThreadId,
      provider: "gmail",
      deduped: result.deduped,
      to: input.to,
      subject: input.subject,
    };
  }

  private async loadOriginal(
    userId: string,
    messageId: string,
  ): Promise<EmailDetail> {
    const id = messageId?.trim();
    if (!id) throw new ValidationError("messageId is required.");
    return this.provider.getMessage({ userId, messageId: id });
  }

  private requireUser(userId: string): string {
    if (!userId) throw new AuthenticationError();
    return userId;
  }

  /**
   * Refuse to send unless a confirmed action supplied its server-derived key.
   * This is the code-level "no confirmation, no send" invariant.
   */
  private requireConfirmedAction(idempotencyKey: string | undefined): string {
    const key = idempotencyKey?.trim();
    if (!key || key.length < 16) {
      throw new AuthorizationError(
        "This message can only be sent after you confirm it.",
      );
    }
    return key;
  }

  private normalizeAddresses(
    addresses: string[],
    field: string,
    required = false,
  ): string[] {
    const normalized: string[] = [];
    for (const raw of addresses) {
      const email = extractEmail(raw);
      if (!email) {
        throw new ValidationError(`"${raw}" is not a valid email address.`);
      }
      if (!normalized.includes(email)) normalized.push(email);
    }

    if (required && normalized.length === 0) {
      throw new ValidationError(`A message needs at least one ${field} recipient.`);
    }
    if (normalized.length > MAX_SEND_RECIPIENTS) {
      throw new ValidationError(
        `A message can have at most ${MAX_SEND_RECIPIENTS} ${field} recipients.`,
      );
    }
    return normalized;
  }

  private normalizeSubject(subject: string): string {
    return subject.trim().slice(0, MAX_SEND_SUBJECT_CHARS);
  }

  private normalizeBody(body: string): string {
    if (!body?.trim()) throw new ValidationError("A message needs a body.");
    if (body.length > MAX_SEND_BODY_CHARS) {
      throw new ValidationError(
        `A message body is limited to ${MAX_SEND_BODY_CHARS} characters.`,
      );
    }
    return body;
  }
}

export const sendService = new SendService();
