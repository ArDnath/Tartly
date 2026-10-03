import "server-only";

import { threadRepository } from "@/lib/repositories/threads";
import { threadSettingsRepository } from "@/lib/repositories/thread-settings";

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
  const [mailboxAutonomy, overrideRows, threadRows] = await Promise.all([
    threadSettingsRepository.findMailboxAutonomyForUser(userId),
    threadSettingsRepository.listContactOverridesForUser(userId),
    threadSettingsRepository.listThreadOverridesWithSubject(userId),
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
    mailboxAutonomy: normalize(mailboxAutonomy) ?? "copilot",
    overrides,
    threadOverrides,
  };
}

export async function setMailboxAutonomy(
  userId: string,
  autonomy: Autonomy,
): Promise<boolean> {
  return threadSettingsRepository.updateMailboxAutonomy({
    userId,
    autonomy,
    now: new Date(),
  });
}

export async function setContactOverride(
  userId: string,
  email: string,
  override: Autonomy | null,
): Promise<boolean> {
  return threadSettingsRepository.updateContactOverride({
    userId,
    email,
    override,
    now: new Date(),
  });
}

/** The raw per-thread override (null = inherit), or null when not the user's. */
export async function getThreadAutonomy(
  userId: string,
  threadId: string,
): Promise<Autonomy | null> {
  const raw = await threadSettingsRepository.findThreadAutonomy({
    userId,
    threadId,
  });
  return normalize(raw);
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
  const owned = await threadRepository.findIdForUser(userId, threadId);
  if (!owned) return false;

  if (autonomy === null) {
    await threadSettingsRepository.deleteThreadAutonomy({ userId, threadId });
    return true;
  }

  await threadSettingsRepository.upsertThreadAutonomy({
    threadId,
    userId,
    autonomy,
    now: new Date(),
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
    const raw = await threadSettingsRepository.findThreadAutonomy({
      userId,
      threadId,
    });
    const value = normalize(raw);
    if (value) return { autonomy: value, source: "thread" };
  }

  if (contactEmail) {
    const raw = await threadSettingsRepository.findContactOverride({
      userId,
      email: contactEmail,
    });
    const value = normalize(raw);
    if (value) return { autonomy: value, source: "contact" };
  }

  const rawMailboxAutonomy = mailboxId
    ? await threadSettingsRepository.findMailboxAutonomyById(mailboxId)
    : await threadSettingsRepository.findMailboxAutonomyForUser(userId);

  return {
    autonomy: normalize(rawMailboxAutonomy) ?? "copilot",
    source: "mailbox",
  };
}
