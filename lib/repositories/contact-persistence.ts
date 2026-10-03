import "server-only";

import { db, type Database } from "@/lib/db";
import { contacts } from "@/lib/db/schema";

/** Write model for contact upserts keyed on `(userId, email)`. */

export type Contact = typeof contacts.$inferSelect;

export class ContactPersistenceRepository {
  constructor(private readonly database: Database = db) {}

  async upsert(input: {
    id: string;
    userId: string;
    email: string;
    name?: string | null;
    source: string;
  }): Promise<Contact> {
    const inserted = await this.database
      .insert(contacts)
      .values({
        id: input.id,
        userId: input.userId,
        email: input.email,
        name: input.name ?? null,
        nameLower: input.name?.toLowerCase() ?? null,
        source: input.source,
      })
      .onConflictDoUpdate({
        target: [contacts.userId, contacts.email],
        set: {
          ...(input.name
            ? { name: input.name, nameLower: input.name.toLowerCase() }
            : {}),
          updatedAt: new Date(),
        },
      })
      .returning();
    return inserted[0];
  }
}

export const contactPersistenceRepository = new ContactPersistenceRepository();
