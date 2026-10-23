import "server-only";

import { and, count, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db, type Database } from "@/lib/db";
import {
  billingAccounts,
  billingWebhookEvents,
  mailSendEvents,
  mailViewEvents,
  subscriptions,
  type BillingInterval,
  type SubscriptionStatus,
} from "@/lib/db/schema";

/**
 * Persistence for the paywall: the per-user billing account (Dodo customer +
 * paywall lock), the mirrored subscription, and the append-only free-tier usage
 * ledgers.
 *
 * Free-tier views are deduped by the unique `(user_id, gmail_message_id)` so
 * re-opening a message never consumes a second allowance. Sends are append-only
 * because every send is a distinct event.
 */

export type BillingAccount = typeof billingAccounts.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;

export class BillingRepository {
  constructor(private readonly database: Database = db) {}

  /** The billing account row, or `undefined` before the user has one. */
  async getAccount(userId: string): Promise<BillingAccount | undefined> {
    const rows = await this.database
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.userId, userId))
      .limit(1);
    return rows[0];
  }

  /** Create the account row if absent (idempotent). */
  async ensureAccount(userId: string): Promise<BillingAccount> {
    const inserted = await this.database
      .insert(billingAccounts)
      .values({ userId })
      .onConflictDoNothing({ target: billingAccounts.userId })
      .returning();
    if (inserted[0]) return inserted[0];
    const existing = await this.getAccount(userId);
    if (!existing) throw new Error("billing account could not be created");
    return existing;
  }

  async findAccountByDodoCustomerId(
    dodoCustomerId: string,
  ): Promise<BillingAccount | undefined> {
    const rows = await this.database
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.dodoCustomerId, dodoCustomerId))
      .limit(1);
    return rows[0];
  }

  async setDodoCustomerId(
    userId: string,
    dodoCustomerId: string,
  ): Promise<void> {
    await this.database
      .insert(billingAccounts)
      .values({ userId, dodoCustomerId })
      .onConflictDoUpdate({
        target: billingAccounts.userId,
        set: { dodoCustomerId, updatedAt: new Date() },
      });
  }

  /**
   * Record that a free user hit the paywall. Uses `coalesce` so the *first*
   * trigger is kept: the lock is about when the wall first appeared, and a later
   * denied action must not move it.
   */
  async lockPaywall(userId: string, reason: string): Promise<void> {
    await this.database
      .insert(billingAccounts)
      .values({
        userId,
        paywallLockedAt: new Date(),
        paywallReason: reason,
      })
      .onConflictDoUpdate({
        target: billingAccounts.userId,
        set: {
          paywallLockedAt: sql`coalesce(${billingAccounts.paywallLockedAt}, now())`,
          paywallReason: reason,
          updatedAt: new Date(),
        },
      });
  }

  /** Clear the paywall lock (on a successful subscription). */
  async unlockPaywall(userId: string): Promise<void> {
    await this.database
      .update(billingAccounts)
      .set({
        paywallLockedAt: null,
        paywallReason: null,
        updatedAt: new Date(),
      })
      .where(eq(billingAccounts.userId, userId));
  }

  async getSubscription(userId: string): Promise<Subscription | undefined> {
    const rows = await this.database
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);
    return rows[0];
  }

  async findSubscriptionByDodoId(
    dodoSubscriptionId: string,
  ): Promise<Subscription | undefined> {
    const rows = await this.database
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.dodoSubscriptionId, dodoSubscriptionId))
      .limit(1);
    return rows[0];
  }

  /** Upsert the single subscription row for a user. */
  async upsertSubscription(input: {
    userId: string;
    dodoSubscriptionId: string | null;
    dodoCustomerId: string | null;
    dodoProductId: string | null;
    status: SubscriptionStatus;
    interval: BillingInterval | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: Date | null;
  }): Promise<Subscription> {
    const updated = await this.database
      .insert(subscriptions)
      .values({
        id: `sub_${nanoid()}`,
        ...input,
      })
      .onConflictDoUpdate({
        target: subscriptions.userId,
        set: {
          dodoSubscriptionId: input.dodoSubscriptionId,
          dodoCustomerId: input.dodoCustomerId,
          dodoProductId: input.dodoProductId,
          status: input.status,
          interval: input.interval,
          currentPeriodEnd: input.currentPeriodEnd,
          cancelAtPeriodEnd: input.cancelAtPeriodEnd,
          canceledAt: input.canceledAt,
          updatedAt: new Date(),
        },
      })
      .returning();
    return updated[0]!;
  }

  /**
   * Record a delivered webhook id exactly once. Returns `true` when this is the
   * first time we have seen it (the caller should apply side effects), `false`
   * for a redelivery (the caller skips them). The insert is atomic, so two
   * concurrent deliveries can never both win.
   */
  async markWebhookEventProcessed(
    webhookId: string,
    eventType: string,
  ): Promise<boolean> {
    const inserted = await this.database
      .insert(billingWebhookEvents)
      .values({ id: webhookId, eventType })
      .onConflictDoNothing({ target: billingWebhookEvents.id })
      .returning({ id: billingWebhookEvents.id });
    return inserted.length > 0;
  }

  /**
   * Release a claim taken by {@link markWebhookEventProcessed}. Called when
   * handling throws, so the redelivery Dodo triggers is processed rather than
   * skipped as a duplicate.
   */
  async removeWebhookEvent(webhookId: string): Promise<void> {
    await this.database
      .delete(billingWebhookEvents)
      .where(eq(billingWebhookEvents.id, webhookId));
  }

  /**
   * Insert a distinct mail view. Returns `true` when this message had not been
   * seen before (the caller then checks the cap), `false` for a re-open.
   */
  async addMailView(userId: string, gmailMessageId: string): Promise<boolean> {
    const inserted = await this.database
      .insert(mailViewEvents)
      .values({ id: `mv_${nanoid()}`, userId, gmailMessageId })
      .onConflictDoNothing({
        target: [mailViewEvents.userId, mailViewEvents.gmailMessageId],
      })
      .returning({ id: mailViewEvents.id });
    return inserted.length > 0;
  }

  async removeMailView(userId: string, gmailMessageId: string): Promise<void> {
    await this.database
      .delete(mailViewEvents)
      .where(
        and(
          eq(mailViewEvents.userId, userId),
          eq(mailViewEvents.gmailMessageId, gmailMessageId),
        ),
      );
  }

  async countMailViews(userId: string): Promise<number> {
    const rows = await this.database
      .select({ value: count() })
      .from(mailViewEvents)
      .where(eq(mailViewEvents.userId, userId));
    return Number(rows[0]?.value ?? 0);
  }

  /** Append a send event (a reservation; released if the send fails). */
  async recordMailSend(input: {
    userId: string;
    kind: "send" | "reply";
  }): Promise<string> {
    const id = `ms_${nanoid()}`;
    await this.database
      .insert(mailSendEvents)
      .values({ id, userId: input.userId, kind: input.kind });
    return id;
  }

  async removeMailSend(id: string): Promise<void> {
    await this.database.delete(mailSendEvents).where(eq(mailSendEvents.id, id));
  }

  async countMailSends(userId: string): Promise<number> {
    const rows = await this.database
      .select({ value: count() })
      .from(mailSendEvents)
      .where(eq(mailSendEvents.userId, userId));
    return Number(rows[0]?.value ?? 0);
  }
}

export const billingRepository = new BillingRepository();
