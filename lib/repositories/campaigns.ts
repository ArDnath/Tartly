import "server-only";

import { and, count, desc, eq, inArray, sql } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import {
  bulkCampaigns,
  bulkRecipients,
  campaignEvents,
  suppressionList,
  type CampaignRecipientStatus,
} from "@/lib/db/schema";

/**
 * Persistence for the bulk-campaign aggregate: `bulk_campaigns`,
 * `bulk_recipients`, `campaign_events` and `suppression_list`.
 *
 * One method = one atomic storage operation (SKILL §1.1). Throttle math, the
 * review gate and reply classification stay in `lib/campaigns/service.ts`.
 */

export type Campaign = typeof bulkCampaigns.$inferSelect;
export type NewCampaign = typeof bulkCampaigns.$inferInsert;
export type CampaignRecipient = typeof bulkRecipients.$inferSelect;
export type NewCampaignRecipient = typeof bulkRecipients.$inferInsert;
export type CampaignEvent = typeof campaignEvents.$inferSelect;
export type Suppression = typeof suppressionList.$inferSelect;

export class CampaignRepository {
  constructor(private readonly database: Database = db) {}

  /* ----- suppression ------------------------------------------------------ */

  async isSuppressed(userId: string, email: string): Promise<boolean> {
    const rows = await this.database
      .select({ id: suppressionList.id })
      .from(suppressionList)
      .where(
        and(
          eq(suppressionList.userId, userId),
          eq(suppressionList.email, email.toLowerCase()),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async addSuppression(input: {
    id: string;
    userId: string;
    email: string;
    reason: string;
  }): Promise<void> {
    await this.database
      .insert(suppressionList)
      .values({
        id: input.id,
        userId: input.userId,
        email: input.email.toLowerCase(),
        reason: input.reason,
      })
      .onConflictDoNothing({
        target: [suppressionList.userId, suppressionList.email],
      });
  }

  async listSuppression(userId: string, limit: number): Promise<Suppression[]> {
    return this.database
      .select()
      .from(suppressionList)
      .where(eq(suppressionList.userId, userId))
      .orderBy(desc(suppressionList.createdAt))
      .limit(limit);
  }

  /** Emails from `emails` already on the user's suppression list. */
  async listSuppressedEmails(
    userId: string,
    emails: string[],
  ): Promise<string[]> {
    if (emails.length === 0) return [];
    const rows = await this.database
      .select({ email: suppressionList.email })
      .from(suppressionList)
      .where(
        and(
          eq(suppressionList.userId, userId),
          inArray(suppressionList.email, emails),
        ),
      );
    return rows.map((row) => row.email);
  }

  /* ----- campaigns -------------------------------------------------------- */

  async insertCampaign(values: NewCampaign): Promise<void> {
    await this.database.insert(bulkCampaigns).values(values);
  }

  async findCampaignByIdForUser(
    userId: string,
    campaignId: string,
  ): Promise<Campaign | undefined> {
    const rows = await this.database
      .select()
      .from(bulkCampaigns)
      .where(
        and(eq(bulkCampaigns.id, campaignId), eq(bulkCampaigns.userId, userId)),
      )
      .limit(1);
    return rows[0];
  }

  async findCampaignById(campaignId: string): Promise<Campaign | undefined> {
    const rows = await this.database
      .select()
      .from(bulkCampaigns)
      .where(eq(bulkCampaigns.id, campaignId))
      .limit(1);
    return rows[0];
  }

  async listCampaignsForUser(
    userId: string,
    limit: number,
  ): Promise<Campaign[]> {
    return this.database
      .select()
      .from(bulkCampaigns)
      .where(eq(bulkCampaigns.userId, userId))
      .orderBy(desc(bulkCampaigns.createdAt))
      .limit(limit);
  }

  /** Explicit field patch by primary key; returns the updated row. */
  async updateCampaignById(
    campaignId: string,
    values: Partial<NewCampaign>,
  ): Promise<Campaign | null> {
    const rows = await this.database
      .update(bulkCampaigns)
      .set(values)
      .where(eq(bulkCampaigns.id, campaignId))
      .returning();
    return rows[0] ?? null;
  }

  /** Guarded `sending → paused`, owner-scoped. */
  async pauseSendingOwned(input: {
    userId: string;
    campaignId: string;
    now: Date;
  }): Promise<boolean> {
    const updated = await this.database
      .update(bulkCampaigns)
      .set({ status: "paused", updatedAt: input.now })
      .where(
        and(
          eq(bulkCampaigns.id, input.campaignId),
          eq(bulkCampaigns.userId, input.userId),
          eq(bulkCampaigns.status, "sending"),
        ),
      )
      .returning({ id: bulkCampaigns.id });
    return updated.length > 0;
  }

  async listStuckSending(
    userId: string,
  ): Promise<Array<{ id: string; userId: string }>> {
    return this.database
      .select({ id: bulkCampaigns.id, userId: bulkCampaigns.userId })
      .from(bulkCampaigns)
      .where(
        and(
          eq(bulkCampaigns.userId, userId),
          eq(bulkCampaigns.status, "sending"),
        ),
      );
  }

  /* ----- recipients ------------------------------------------------------- */

  async insertRecipient(values: NewCampaignRecipient): Promise<boolean> {
    const inserted = await this.database
      .insert(bulkRecipients)
      .values(values)
      .onConflictDoNothing({
        target: [bulkRecipients.campaignId, bulkRecipients.email],
      })
      .returning({ id: bulkRecipients.id });
    return inserted.length > 0;
  }

  async listRecipients(input: {
    campaignId: string;
    userId: string;
    limit: number;
  }): Promise<CampaignRecipient[]> {
    return this.database
      .select()
      .from(bulkRecipients)
      .where(
        and(
          eq(bulkRecipients.campaignId, input.campaignId),
          eq(bulkRecipients.userId, input.userId),
        ),
      )
      .orderBy(desc(bulkRecipients.createdAt))
      .limit(input.limit);
  }

  /** Grouped recipient counts for one campaign. */
  async countByStatus(campaignId: string): Promise<
    Array<{ status: CampaignRecipientStatus; n: number }>
  > {
    const rows = await this.database
      .select({
        status: bulkRecipients.status,
        n: sql<number>`count(*)::int`,
      })
      .from(bulkRecipients)
      .where(eq(bulkRecipients.campaignId, campaignId))
      .groupBy(bulkRecipients.status);
    return rows.map((row) => ({ status: row.status, n: Number(row.n) }));
  }

  /** Grouped counts across a set of campaigns (dashboard list view). */
  async countByStatusForCampaigns(
    campaignIds: string[],
  ): Promise<Array<{ campaignId: string; status: CampaignRecipientStatus; n: number }>> {
    if (campaignIds.length === 0) return [];
    const rows = await this.database
      .select({
        campaignId: bulkRecipients.campaignId,
        status: bulkRecipients.status,
        n: count(),
      })
      .from(bulkRecipients)
      .where(inArray(bulkRecipients.campaignId, campaignIds))
      .groupBy(bulkRecipients.campaignId, bulkRecipients.status);
    return rows.map((row) => ({
      campaignId: row.campaignId,
      status: row.status,
      n: Number(row.n),
    }));
  }

  async countRecipientsByStatuses(
    campaignId: string,
    statuses: CampaignRecipientStatus[],
  ): Promise<number> {
    const rows = await this.database
      .select({ n: sql<number>`count(*)::int` })
      .from(bulkRecipients)
      .where(
        and(
          eq(bulkRecipients.campaignId, campaignId),
          inArray(bulkRecipients.status, statuses),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  }

  async countPending(campaignId: string): Promise<number> {
    return this.countRecipientsByStatuses(campaignId, ["pending"]);
  }

  async countSentSinceForUser(userId: string, since: Date): Promise<number> {
    const rows = await this.database
      .select({ n: sql<number>`count(*)::int` })
      .from(bulkRecipients)
      .where(
        and(
          eq(bulkRecipients.userId, userId),
          eq(bulkRecipients.status, "sent"),
          sql`${bulkRecipients.sentAt} >= ${since.toISOString()}`,
        ),
      );
    return Number(rows[0]?.n ?? 0);
  }

  async countSentSinceForCampaign(
    campaignId: string,
    since: Date,
  ): Promise<number> {
    const rows = await this.database
      .select({ n: sql<number>`count(*)::int` })
      .from(bulkRecipients)
      .where(
        and(
          eq(bulkRecipients.campaignId, campaignId),
          eq(bulkRecipients.status, "sent"),
          sql`${bulkRecipients.sentAt} >= ${since.toISOString()}`,
        ),
      );
    return Number(rows[0]?.n ?? 0);
  }

  async updateRecipientById(
    recipientId: string,
    values: Partial<NewCampaignRecipient>,
  ): Promise<void> {
    await this.database
      .update(bulkRecipients)
      .set(values)
      .where(eq(bulkRecipients.id, recipientId));
  }

  /** Return every `sending` row of a campaign to `pending` (pause/resume). */
  async resetSendingToPending(campaignId: string): Promise<void> {
    await this.database
      .update(bulkRecipients)
      .set({ status: "pending" })
      .where(
        and(
          eq(bulkRecipients.campaignId, campaignId),
          eq(bulkRecipients.status, "sending"),
        ),
      );
  }

  /** Skip every un-finished recipient (cancel). */
  async skipUnfinished(campaignId: string): Promise<void> {
    await this.database
      .update(bulkRecipients)
      .set({ status: "skipped" })
      .where(
        and(
          eq(bulkRecipients.campaignId, campaignId),
          inArray(bulkRecipients.status, ["pending", "failed", "sending"]),
        ),
      );
  }

  /** Recover rows a crashed batch left `sending` before `cutoff`. */
  async resetStaleClaims(input: {
    campaignId: string;
    cutoff: Date;
  }): Promise<number> {
    const updated = await this.database
      .update(bulkRecipients)
      .set({ status: "pending" })
      .where(
        and(
          eq(bulkRecipients.campaignId, input.campaignId),
          eq(bulkRecipients.status, "sending"),
          sql`${bulkRecipients.updatedAt} < ${input.cutoff.toISOString()}`,
        ),
      )
      .returning({ id: bulkRecipients.id });
    return updated.length;
  }

  /**
   * Atomically claim a batch of pending recipients (`FOR UPDATE SKIP LOCKED`) so
   * a crashed or duplicated job can only claim rows it actually holds.
   */
  async claimRecipientBatch(
    campaignId: string,
    limit: number,
  ): Promise<CampaignRecipient[]> {
    const result = (await this.database.execute(sql`
      update bulk_recipients r
          set attempts = attempts + 1,
              status = 'sending',
              updated_at = now()
        where r.id in (
          select id from bulk_recipients
           where campaign_id = ${campaignId} and status = 'pending'
           order by created_at
           limit ${limit}
           for update skip locked
        )
        returning r.*
    `)) as unknown as { rows: CampaignRecipient[] };
    return result.rows;
  }

  async findRecipientForReplyByThread(
    userId: string,
    threadId: string,
  ): Promise<CampaignRecipient | undefined> {
    const rows = await this.database
      .select()
      .from(bulkRecipients)
      .where(
        and(
          eq(bulkRecipients.userId, userId),
          eq(bulkRecipients.threadId, threadId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async findSentRecipientByEmail(
    userId: string,
    email: string,
  ): Promise<CampaignRecipient | undefined> {
    const rows = await this.database
      .select()
      .from(bulkRecipients)
      .where(
        and(
          eq(bulkRecipients.userId, userId),
          eq(bulkRecipients.email, email.toLowerCase()),
          eq(bulkRecipients.status, "sent"),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /* ----- events ----------------------------------------------------------- */

  async insertEvent(values: {
    id: string;
    userId: string;
    campaignId: string;
    recipientId?: string | null;
    type: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await this.database.insert(campaignEvents).values(values);
  }
}

export const campaignRepository = new CampaignRepository();
