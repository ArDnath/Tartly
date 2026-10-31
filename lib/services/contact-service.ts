import "server-only";

import { AuthenticationError, ValidationError } from "@/lib/agent/errors";
import { isUnreachable } from "@/lib/mail/service";
import { unifiedEmailProvider } from "@/lib/providers/email/unified-provider";
import type {
  EmailCorrespondent,
  EmailProvider,
} from "@/lib/providers/email/types";
import { extractEmail } from "@/lib/services/draft-service";

/**
 * ContactService — the mailbox's people directory.
 *
 * The seed is observed correspondence: `listCorrespondents` harvests addresses
 * from real message headers, so a contact in `KNOWN_CONTACT` state is someone
 * this mailbox has *actually exchanged mail with*, not someone the model
 * guessed. That distinction is the whole point:
 *
 *   KNOWN_CONTACT        observed in sent/received mail (safe to address)
 *   DISCOVERED_CONTACT   found by research, unverified (confirm before sending)
 *   UNVERIFIED_CONTACT   syntactically valid but never seen (confirm before sending)
 *
 * The service is integration-agnostic and owner-scoped: every call takes the
 * authenticated `userId` and never trusts a caller-supplied identity.
 */

export type ContactTrust =
  | "KNOWN_CONTACT"
  | "DISCOVERED_CONTACT"
  | "UNVERIFIED_CONTACT";

export interface Contact {
  email: string;
  name: string;
  trust: ContactTrust;
  /** Messages this mailbox sent to them (KNOWN_CONTACT only). */
  sent: number;
  /** Messages received from them (KNOWN_CONTACT only). */
  received: number;
  /** ISO timestamp of the most recent exchange, when known. */
  lastSeen: string | null;
  /** False for automated senders that cannot receive a reply. */
  reachable: boolean;
}

export const MAX_CONTACT_RESULTS = 25;
export const DEFAULT_CONTACT_RESULTS = 10;
/** Upper bound on correspondents scanned when resolving a lookup. */
export const MAX_CORRESPONDENT_SCAN = 500;

function correspondentToContact(correspondent: EmailCorrespondent): Contact {
  return {
    email: correspondent.email,
    name: correspondent.name,
    trust: "KNOWN_CONTACT",
    sent: correspondent.sent,
    received: correspondent.received,
    lastSeen: correspondent.lastSeen,
    reachable: !isUnreachable(correspondent.email),
  };
}

/** A bare, lower-cased address, or null when the input is not address-shaped. */
function normalizeEmail(value: string | undefined): string | null {
  if (!value) return null;
  return extractEmail(value);
}

export class ContactService {
  constructor(
    private readonly provider: Pick<EmailProvider, "listCorrespondents"> =
      unifiedEmailProvider,
  ) {}

  /** Free-text search over name and address, most recent first. */
  async searchContacts(input: {
    userId: string;
    query?: string;
    limit?: number;
  }): Promise<Contact[]> {
    const userId = this.requireUser(input.userId);
    const terms = (input.query ?? "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const limit = Math.min(
      Math.max(input.limit ?? DEFAULT_CONTACT_RESULTS, 1),
      MAX_CONTACT_RESULTS,
    );

    const directory = await this.provider.listCorrespondents({
      userId,
      limit: MAX_CORRESPONDENT_SCAN,
    });

    const matches = directory.filter((correspondent) => {
      if (terms.length === 0) return true;
      const name = correspondent.name.toLowerCase();
      return terms.every(
        (term) => correspondent.email.includes(term) || name.includes(term),
      );
    });

    return matches.slice(0, limit).map(correspondentToContact);
  }

  /**
   * Resolve one contact. Returns `null` when the input cannot be matched; a
   * valid-but-unseen address resolves to `UNVERIFIED_CONTACT` rather than a
   * fabricated person, so the model can ask for confirmation instead of
   * inventing one.
   */
  async getContact(input: {
    userId: string;
    email?: string;
    name?: string;
  }): Promise<Contact | null> {
    const userId = this.requireUser(input.userId);
    const email = normalizeEmail(input.email);
    const name = input.name?.trim();

    if (!email && !name) {
      throw new ValidationError("Provide an email address or a name.");
    }

    const directory = await this.provider.listCorrespondents({
      userId,
      limit: MAX_CORRESPONDENT_SCAN,
    });

    if (email) {
      const known = directory.find(
        (correspondent) => correspondent.email === email,
      );
      if (known) return correspondentToContact(known);
      return {
        email,
        name: name || email.split("@")[0]!,
        trust: "UNVERIFIED_CONTACT",
        sent: 0,
        received: 0,
        lastSeen: null,
        reachable: !isUnreachable(email),
      };
    }

    // Name-only lookup: the best recent match, or nothing. Never a guess.
    const needle = name!.toLowerCase();
    const match = directory.find(
      (correspondent) =>
        correspondent.name.toLowerCase() === needle ||
        correspondent.email === needle ||
        correspondent.email.split("@")[0]!.toLowerCase() === needle,
    );
    return match ? correspondentToContact(match) : null;
  }

  private requireUser(userId: string): string {
    if (!userId) throw new AuthenticationError();
    return userId;
  }
}

export const contactService = new ContactService();
