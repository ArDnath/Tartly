import "server-only";

import { and, eq } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { account } from "@/lib/db/schema";

/** Read model for Better Auth's linked-account rows. */

export class GoogleAccountRepository {
  constructor(private readonly database: Database = db) {}

  /**
   * Resolves the local `account` row id for a user's linked provider account.
   * This is the Better Auth account id, not the provider subject id.
   */
  async findIdByUserAndProvider(input: {
    userId: string;
    providerId: string;
  }): Promise<string | undefined> {
    const rows = await this.database
      .select({ id: account.id })
      .from(account)
      .where(
        and(
          eq(account.userId, input.userId),
          eq(account.providerId, input.providerId),
        ),
      )
      .limit(1);
    return rows[0]?.id;
  }

  /** Every granted scope string for a user's linked provider account. */
  async listScopesByUserAndProvider(input: {
    userId: string;
    providerId: string;
  }): Promise<(string | null)[]> {
    const rows = await this.database
      .select({ scope: account.scope })
      .from(account)
      .where(
        and(
          eq(account.userId, input.userId),
          eq(account.providerId, input.providerId),
        ),
      );
    return rows.map((row) => row.scope);
  }

  /**
   * Every linked provider account for a user. Powers the "connected accounts"
   * surface, which needs the provider, its granted scopes and the local account
   * id (for token lookup) in one read.
   */
  async listByUser(userId: string): Promise<
    Array<{
      id: string;
      providerId: string;
      accountId: string;
      scope: string | null;
    }>
  > {
    return this.database
      .select({
        id: account.id,
        providerId: account.providerId,
        accountId: account.accountId,
        scope: account.scope,
      })
      .from(account)
      .where(eq(account.userId, userId));
  }
}

export const googleAccountRepository = new GoogleAccountRepository();
