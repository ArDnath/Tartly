import "server-only";

import { and, eq } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import {
  assetExtractions,
  type AssetExtractionStatus,
} from "@/lib/db/schema";

/**
 * Persistence for encrypted attachment text. One row per asset (unique index),
 * owner-scoped on every read. The repository never touches the ciphertext's
 * meaning — sealing and opening live in `lib/assets/crypto`.
 */

export type AssetExtraction = typeof assetExtractions.$inferSelect;
export type NewAssetExtraction = typeof assetExtractions.$inferInsert;

export class AssetExtractionRepository {
  constructor(private readonly database: Database = db) {}

  async findByAssetForUser(
    userId: string,
    assetId: string,
  ): Promise<AssetExtraction | undefined> {
    const rows = await this.database
      .select()
      .from(assetExtractions)
      .where(
        and(
          eq(assetExtractions.userId, userId),
          eq(assetExtractions.assetId, assetId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /** Insert or replace the row for an asset (a re-run supersedes the old one). */
  async upsert(input: {
    row: NewAssetExtraction;
    status: AssetExtractionStatus;
  }): Promise<AssetExtraction> {
    const { row } = input;
    const inserted = await this.database
      .insert(assetExtractions)
      .values(row)
      .onConflictDoUpdate({
        target: [assetExtractions.assetId],
        set: {
          status: row.status,
          parser: row.parser,
          ciphertext: row.ciphertext,
          iv: row.iv,
          tag: row.tag,
          charCount: row.charCount,
          truncated: row.truncated,
          error: row.error,
          updatedAt: new Date(),
        },
      })
      .returning();
    return inserted[0]!;
  }

  async deleteByAsset(assetId: string): Promise<void> {
    await this.database
      .delete(assetExtractions)
      .where(eq(assetExtractions.assetId, assetId));
  }
}

export const assetExtractionRepository = new AssetExtractionRepository();
