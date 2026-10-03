import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { assets, type AssetKind } from "@/lib/db/schema";

/**
 * Persistence for the `assets` library.
 *
 * Bytes live in object storage; this repository owns only metadata rows
 * (SKILL §1.1). Every read/write is owner-scoped, and the `(user_id, sha256)`
 * upsert is what makes an identical re-upload idempotent.
 */

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;

export class AssetRepository {
  constructor(private readonly database: Database = db) {}

  /** Any row (including soft-deleted) with the same content hash. */
  async findByUserAndSha(
    userId: string,
    sha256: string,
  ): Promise<Asset | undefined> {
    const rows = await this.database
      .select()
      .from(assets)
      .where(and(eq(assets.userId, userId), eq(assets.sha256, sha256)))
      .limit(1);
    return rows[0];
  }

  /**
   * Insert or revive the `(userId, sha256)` row. `altTextProvided` mirrors the
   * caller's "field was present" distinction so an omitted alt text never
   * clears an existing one.
   */
  async upsert(input: {
    row: NewAsset;
    altTextProvided: boolean;
  }): Promise<Asset> {
    const { row } = input;
    const inserted = await this.database
      .insert(assets)
      .values(row)
      .onConflictDoUpdate({
        target: [assets.userId, assets.sha256],
        set: {
          filename: row.filename,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
          width: row.width,
          height: row.height,
          storageKey: row.storageKey,
          deletedAt: null,
          ...(input.altTextProvided ? { altText: row.altText } : {}),
        },
      })
      .returning();
    return inserted[0]!;
  }

  async listActive(input: {
    userId: string;
    kind?: AssetKind;
    limit: number;
  }): Promise<Asset[]> {
    const conditions = [eq(assets.userId, input.userId), isNull(assets.deletedAt)];
    if (input.kind) conditions.push(eq(assets.kind, input.kind));
    return this.database
      .select()
      .from(assets)
      .where(and(...conditions))
      .orderBy(desc(assets.createdAt))
      .limit(input.limit);
  }

  /** Soft-deleted rows are invisible; the bytes stay for a cheap re-send. */
  async findActiveByIdForUser(
    userId: string,
    id: string,
  ): Promise<Asset | undefined> {
    const rows = await this.database
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.id, id),
          eq(assets.userId, userId),
          isNull(assets.deletedAt),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /** Any row for the owner, soft-deleted included (purge path). */
  async findByIdForUser(
    userId: string,
    id: string,
  ): Promise<Asset | undefined> {
    const rows = await this.database
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), eq(assets.userId, userId)))
      .limit(1);
    return rows[0];
  }

  async updateAltText(input: {
    userId: string;
    id: string;
    altText: string | null;
    now: Date;
  }): Promise<Asset | null> {
    const updated = await this.database
      .update(assets)
      .set({ altText: input.altText, updatedAt: input.now })
      .where(and(eq(assets.id, input.id), eq(assets.userId, input.userId)))
      .returning();
    return updated[0] ?? null;
  }

  /** Owner-scoped soft delete; false when nothing matching was updated. */
  async softDelete(input: {
    userId: string;
    id: string;
    now: Date;
  }): Promise<boolean> {
    const updated = await this.database
      .update(assets)
      .set({ deletedAt: input.now, updatedAt: input.now })
      .where(and(eq(assets.id, input.id), eq(assets.userId, input.userId)))
      .returning({ id: assets.id });
    return updated.length > 0;
  }

  async hardDelete(id: string): Promise<void> {
    await this.database.delete(assets).where(eq(assets.id, id));
  }
}

export const assetRepository = new AssetRepository();
