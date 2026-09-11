import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { contacts, mailboxes } from "@/lib/db/schema";

/**
 * Autonomy settings: the mailbox default (`copilot` drafts, `autopilot` sends)
 * plus per-contact overrides. The egress step is the only reader.
 */

export type Autonomy = "copilot" | "autopilot";

export type AutonomySettings = {
  mailboxAutonomy: Autonomy | null;
  overrides: Array<{ email: string; name: string | null; override: Autonomy }>;
};

function normalize(value: string | null | undefined): Autonomy | null {
  return value === "autopilot" || value === "copilot" ? value : null;
}

export async function getAutonomySettings(
  userId: string,
): Promise<AutonomySettings> {
  const mailboxRows = await db
    .select({ autonomy: mailboxes.autonomy })
    .from(mailboxes)
    .where(eq(mailboxes.userId, userId))
    .limit(1);

  const overrideRows = await db
    .select({
      email: contacts.email,
      name: contacts.name,
      override: contacts.autonomyOverride,
    })
    .from(contacts)
    .where(eq(contacts.userId, userId));

  const overrides = overrideRows.flatMap((row) => {
    const value = normalize(row.override);
    return value ? [{ email: row.email, name: row.name, override: value }] : [];
  });

  return {
    mailboxAutonomy: normalize(mailboxRows[0]?.autonomy) ?? "copilot",
    overrides,
  };
}

export async function setMailboxAutonomy(
  userId: string,
  autonomy: Autonomy,
): Promise<boolean> {
  const updated = await db
    .update(mailboxes)
    .set({ autonomy, updatedAt: new Date() })
    .where(eq(mailboxes.userId, userId))
    .returning({ id: mailboxes.id });
  return updated.length > 0;
}

export async function setContactOverride(
  userId: string,
  email: string,
  override: Autonomy | null,
): Promise<boolean> {
  const updated = await db
    .update(contacts)
    .set({ autonomyOverride: override, updatedAt: new Date() })
    .where(
      and(eq(contacts.userId, userId), eq(contacts.email, email.toLowerCase())),
    )
    .returning({ id: contacts.id });
  return updated.length > 0;
}
