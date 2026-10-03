import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { contacts } from "@/lib/db/schema";

/** Persistence for the `contacts` directory. */

export type Contact = typeof contacts.$inferSelect;

export class ContactRepository {
  constructor(private readonly database: Database = db) {}

  async listNamesByEmails(
    userId: string,
    emails: string[],
  ): Promise<Array<{ email: string; name: string | null }>> {
    if (emails.length === 0) return [];
    return this.database
      .select({ email: contacts.email, name: contacts.name })
      .from(contacts)
      .where(and(eq(contacts.userId, userId), inArray(contacts.email, emails)));
  }
}

export const contactRepository = new ContactRepository();
