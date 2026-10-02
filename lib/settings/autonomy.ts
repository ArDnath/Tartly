import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { contacts, mailboxes, threadSettings, threads } from "@/lib/db/schema";

/**
 * Autonomy settings: the mailbox default (`copilot` drafts, `autopilot` sends),
 * per-contact overrides and per-thread overrides. The egress step is the only
 * reader of the effective mode; the UI reads the raw scopes to render where the
 * decision comes from.
 *
 * Precedence (all levels override **both** ways):
 *   thread_settings.autonomy > contacts.autonomyOverride > mailboxes.autonomy
 *   > "copilot".
 */

export type Autonomy = "copilot" | "autopilot";
export type AutonomySource = "thread" | "contact" | "mailbox";

export type AutonomySettings = {
  mailboxAutonomy: Autonomy | null;
  overrides: Array<{ email: string; name: string | null; override: Autonomy }>;
  /** Explicit per-thread overrides, for the inbox/settings surfaces. */
  threadOverrides: Array<{
    threadId: string;
    subject: string | null;
    override: Autonomy;
  }>;
};

function normalize(value: string | null | undefined): Autonomy | null {
  return value === "autopilot" || value === "copilot" ? value : null;
}

export async function getAutonomySettings(
  userId: string,
): Promise<AutonomySettings> {
  const [mailboxRows, overrideRows, threadRows] = await Promise.all([
    db
      .select({ autonomy: mailboxes.autonomy })
      .from(mailboxes)
      .where(eq(mailboxes.userId, userId))
      .limit(1),
    db
      .select({
        email: contacts.email,
        name: contacts.name,
        override: contacts.autonomyOverride,
      })
      .from(contacts)
      .where(eq(contacts.userId, userId)),
    db
      .select({
        threadId: threadSettings.threadId,
        autonomy: threadSettings.autonomy,
        subject: threads.subject,
      })
      .from(threadSettings)
      .leftJoin(threads, eq(threads.id, threadSettings.threadId))
      .where(eq(threadSettings.userId, userId)),
  ]);

  const overrides = overrideRows.flatMap((row) => {
    const value = normalize(row.override);
    return value ? [{ email: row.email, name: row.name, override: value }] : [];
  });

  const threadOverrides = threadRows.flatMap((row) => {
    const value = normalize(row.autonomy);
    return value
      ? [{ threadId: row.threadId, subject: row.subject, override: value }]
      : [];
  });

  return {
    mailboxAutonomy: normalize(mailboxRows[0]?.autonomy) ?? "copilot",
    overrides,
    threadOverrides,
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

/** The raw per-thread override (null = inherit), or null when not the user's. */
export async function getThreadAutonomy(
  userId: string,
  threadId: string,
): Promise<Autonomy | null> {
  const rows = await db
    .select({ autonomy: threadSettings.autonomy })
    .from(threadSettings)
    .where(
      and(
        eq(threadSettings.threadId, threadId),
        eq(threadSettings.userId, userId),
      ),
    )
    .limit(1);
  return normalize(rows[0]?.autonomy);
}

/**
 * Set or clear a thread override. Passing `null` clears it (back to inherit).
 * Verifies thread ownership so a caller cannot affect another user's thread.
 */
export async function setThreadAutonomy(
  userId: string,
  threadId: string,
  autonomy: Autonomy | null,
): Promise<boolean> {
  const owned = await db
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId)))
    .limit(1);
  if (!owned[0]) return false;

  if (autonomy === null) {
    await db
      .delete(threadSettings)
      .where(
        and(
          eq(threadSettings.threadId, threadId),
          eq(threadSettings.userId, userId),
        ),
      );
    return true;
  }

  await db
    .insert(threadSettings)
    .values({ threadId, userId, autonomy })
    .onConflictDoUpdate({
      target: threadSettings.threadId,
      set: { autonomy, updatedAt: new Date() },
    });
  return true;
}

export type ResolvedAutonomy = {
  autonomy: Autonomy;
  source: AutonomySource;
};

/**
 * Resolve the effective mode for a thread, walking the precedence ladder. Used
 * by the egress gate and by the UI to explain *why* a thread is in a mode.
 */
export async function resolveAutonomy({
  userId,
  threadId,
  contactEmail,
  mailboxId,
}: {
  userId: string;
  threadId?: string | null;
  contactEmail?: string | null;
  mailboxId?: string | null;
}): Promise<ResolvedAutonomy> {
  if (threadId) {
    const rows = await db
      .select({ autonomy: threadSettings.autonomy })
      .from(threadSettings)
      .where(
        and(
          eq(threadSettings.threadId, threadId),
          eq(threadSettings.userId, userId),
        ),
      )
      .limit(1);
    const value = normalize(rows[0]?.autonomy);
    if (value) return { autonomy: value, source: "thread" };
  }

  if (contactEmail) {
    const rows = await db
      .select({ override: contacts.autonomyOverride })
      .from(contacts)
      .where(
        and(
          eq(contacts.userId, userId),
          eq(contacts.email, contactEmail.toLowerCase()),
        ),
      )
      .limit(1);
    const value = normalize(rows[0]?.override);
    if (value) return { autonomy: value, source: "contact" };
  }

  const mailboxRows = mailboxId
    ? await db
        .select({ autonomy: mailboxes.autonomy })
        .from(mailboxes)
        .where(eq(mailboxes.id, mailboxId))
        .limit(1)
    : await db
        .select({ autonomy: mailboxes.autonomy })
        .from(mailboxes)
        .where(eq(mailboxes.userId, userId))
        .limit(1);

  return {
    autonomy: normalize(mailboxRows[0]?.autonomy) ?? "copilot",
    source: "mailbox",
  };
}
