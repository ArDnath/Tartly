import "server-only";

import { isMicrosoftConfigured } from "@/lib/env";
import { profile } from "@/lib/mail/service";
import type { MailAccount, MailProvider } from "@/lib/mail/types";
import {
  GOOGLE_MAIL_ACCESS_SCOPE,
  MICROSOFT_MAIL_ACCESS_SCOPE,
  hasScope,
  parseScopeList,
} from "@/lib/outlook/scopes";
import { outlookProfile } from "@/lib/outlook/service";
import { googleAccountRepository } from "@/lib/repositories/google-account";

/**
 * The user's connected mail accounts, and which of them the shared inbox should
 * read from.
 *
 * Better Auth's `account` table is the source of truth for "is it connected";
 * the provider's own profile endpoint supplies the address (best-effort — a
 * missing mailbox scope simply leaves the email blank).
 */

export type MailProviderId = "google" | "microsoft";

/** Map a Better Auth provider id onto the mail client's provider vocabulary. */
export function mailProviderFor(providerId: MailProviderId): MailProvider {
  return providerId === "microsoft" ? "outlook" : "gmail";
}

/** Short-lived cache of resolved account addresses (rarely change). */
const EMAIL_TTL_MS = 5 * 60 * 1000;
const emailCache = new Map<string, { value: string | null; expiresAt: number }>();

async function resolveEmail(
  userId: string,
  providerId: MailProviderId,
): Promise<string | null> {
  const key = `${userId}:${providerId}`;
  const cached = emailCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: string | null = null;
  try {
    value =
      providerId === "microsoft"
        ? (await outlookProfile(userId)).emailAddress || null
        : (await profile(userId)).emailAddress || null;
  } catch {
    // A live grant without the mailbox scope (or a transient Graph/Gmail
    // failure) leaves the address unresolved rather than failing the panel.
    value = null;
  }

  emailCache.set(key, { value, expiresAt: Date.now() + EMAIL_TTL_MS });
  return value;
}

interface AccountRow {
  providerId: string;
  scope: string | null;
}

/**
 * Every mail account the settings surface lists — Gmail and Outlook always,
 * whether or not they are currently connected, so a user can connect or
 * reconnect from one place.
 */
export async function listConnectedAccounts(userId: string): Promise<MailAccount[]> {
  const rows = await googleAccountRepository.listByUser(userId);
  const byProvider = new Map<string, AccountRow>(
    rows.map((row) => [row.providerId, row] as const),
  );

  const definitions: Array<{
    providerId: MailProviderId;
    accessScope: string;
    available: boolean;
  }> = [
    { providerId: "google", accessScope: GOOGLE_MAIL_ACCESS_SCOPE, available: true },
    {
      providerId: "microsoft",
      accessScope: MICROSOFT_MAIL_ACCESS_SCOPE,
      available: isMicrosoftConfigured(),
    },
  ];

  const accounts: MailAccount[] = [];
  for (const definition of definitions) {
    const row = byProvider.get(definition.providerId);
    const connected = Boolean(row);
    const scopes = row ? parseScopeList(row.scope) : [];
    const mailboxAccess = Boolean(row && hasScope(row.scope, definition.accessScope));

    accounts.push({
      provider: mailProviderFor(definition.providerId),
      providerId: definition.providerId,
      email: connected ? await resolveEmail(userId, definition.providerId) : null,
      connected,
      mailboxAccess,
      available: definition.available,
      scopes,
    });
  }

  return accounts;
}

/**
 * The provider ids the shared inbox may read mail from: only accounts that are
 * both linked *and* granted mailbox access. Order is stable (Gmail first) so the
 * merge is deterministic.
 */
export async function connectedMailProviders(
  userId: string,
): Promise<MailProviderId[]> {
  const rows = await googleAccountRepository.listByUser(userId);
  const byProvider = new Map(rows.map((row) => [row.providerId, row] as const));

  const providers: MailProviderId[] = [];
  const google = byProvider.get("google");
  if (google && hasScope(google.scope, GOOGLE_MAIL_ACCESS_SCOPE)) {
    providers.push("google");
  }
  const microsoft = byProvider.get("microsoft");
  if (
    microsoft &&
    isMicrosoftConfigured() &&
    hasScope(microsoft.scope, MICROSOFT_MAIL_ACCESS_SCOPE)
  ) {
    providers.push("microsoft");
  }
  return providers;
}

/**
 * The resolved address of each connected mail account, keyed by the mail
 * client's provider vocabulary. Used to tag shared-inbox rows with the account
 * that owns them.
 */
export async function resolveProviderEmails(
  userId: string,
): Promise<{ gmail: string | null; outlook: string | null }> {
  return {
    gmail: await resolveEmail(userId, "google"),
    outlook: await resolveEmail(userId, "microsoft"),
  };
}
