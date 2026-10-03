import "server-only";

import { nanoid } from "nanoid";

import { archive } from "@/lib/mail/service";
import { messageRepository } from "@/lib/repositories/messages";
import { senderProfileRepository } from "@/lib/repositories/sender-profiles";
import { unsubscribeAttemptRepository } from "@/lib/repositories/unsubscribe-attempts";
import { assertSafeOutboundUrl, SsrfBlockedError } from "@/lib/security/ssrf";
import type { MessageUnsubscribeInfo } from "@/lib/db/schema";

import { normalizeSenderEmail } from "./sender-profiles";

/**
 * Bulk unsubscribe (C7).
 *
 * Prefers RFC 8058 one-click (a `POST List-Unsubscribe=One-Click` to the
 * sender's own endpoint — no email leaves the mailbox), falls back to surfacing
 * the `mailto:` address for the user to send, and otherwise reports that the
 * sender offered no mechanism. Every attempt is logged, and archiving the
 * thread is idempotent, so a double-click cannot double-act.
 */

export type UnsubscribeMethod = "one-click" | "mailto" | "link" | "none";
export type UnsubscribeStatus = "succeeded" | "queued" | "failed" | "no-mechanism";

export type UnsubscribeMechanism = {
  method: UnsubscribeMethod;
  /** The URL (one-click/link) or mailto address to use. */
  target: string | null;
};

/** Pure mechanism selection — the deterministic core of this feature. */
export function selectUnsubscribeMechanism(
  info: MessageUnsubscribeInfo | null | undefined,
): UnsubscribeMechanism {
  if (!info) return { method: "none", target: null };
  if (info.oneClick && info.url) return { method: "one-click", target: info.url };
  if (info.mailto) return { method: "mailto", target: info.mailto };
  if (info.url) return { method: "link", target: info.url };
  return { method: "none", target: null };
}

/** Latest stored unsubscribe headers for a sender (mirror; no Gmail call). */
export async function findSenderUnsubscribeInfo({
  userId,
  senderEmail,
}: {
  userId: string;
  senderEmail: string;
}): Promise<{ info: MessageUnsubscribeInfo; messageId: string } | null> {
  const email = normalizeSenderEmail(senderEmail);
  const row = await messageRepository.findLatestInboundWithUnsubscribe({
    userId,
    email,
  });

  if (!row?.unsubscribe) return null;
  return {
    info: row.unsubscribe as MessageUnsubscribeInfo,
    messageId: row.gmailMessageId,
  };
}

export type UnsubscribeResult = {
  method: UnsubscribeMethod;
  status: UnsubscribeStatus;
  /** For "mailto": the address to write to. For "link": the page to open. */
  target: string | null;
  archived: number;
  note: string;
};

/** POST the one-click endpoint. Bounded; never throws to the caller. */
async function sendOneClick(target: string): Promise<{ ok: boolean; detail: string }> {
  try {
    // `target` comes from an attacker-controllable `List-Unsubscribe` header, so
    // never POST it to a loopback/private/metadata address (SSRF).
    await assertSafeOutboundUrl(target);
  } catch (error) {
    return {
      ok: false,
      detail:
        error instanceof SsrfBlockedError ? "blocked address" : "request failed",
    };
  }
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: response.ok, detail: `http ${response.status}` };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message.slice(0, 120) : "request failed",
    };
  }
}

async function archiveThreadMessages({
  userId,
  threadId,
}: {
  userId: string;
  threadId: string;
}): Promise<number> {
  const ids = await messageRepository.listGmailIdsByThreadOwned({
    userId,
    threadId,
  });
  if (ids.length === 0) return 0;
  try {
    await archive(userId, ids);
    return ids.length;
  } catch (error) {
    console.warn("[ai/unsubscribe] archive failed", error);
    return 0;
  }
}

/**
 * Unsubscribe the user from a sender and (optionally) archive the thread.
 * Idempotent: repeated calls re-run the same safe operations and log new rows.
 */
export async function performUnsubscribe({
  userId,
  senderEmail,
  threadId,
  archiveThread = true,
}: {
  userId: string;
  senderEmail: string;
  threadId?: string;
  archiveThread?: boolean;
}): Promise<UnsubscribeResult> {
  const email = normalizeSenderEmail(senderEmail);
  const found = await findSenderUnsubscribeInfo({ userId, senderEmail: email });
  const mechanism = selectUnsubscribeMechanism(found?.info);

  let status: UnsubscribeStatus;
  let note: string;

  if (mechanism.method === "one-click" && mechanism.target) {
    const { ok, detail } = await sendOneClick(mechanism.target);
    status = ok ? "succeeded" : "failed";
    note = ok ? "Unsubscribed via one-click." : `One-click failed (${detail}).`;
  } else if (mechanism.method === "mailto") {
    status = "queued";
    note = "This sender only supports unsubscribe by email — we've prepared the address.";
  } else if (mechanism.method === "link") {
    status = "queued";
    note = "Open the sender's unsubscribe link to finish.";
  } else {
    status = "no-mechanism";
    note = "No unsubscribe mechanism was offered; marking the sender as blocked instead.";
  }

  await unsubscribeAttemptRepository.insert({
    id: nanoid(),
    userId,
    senderEmail: email,
    method: mechanism.method,
    status,
    messageId: found?.messageId ?? null,
    detail: { note, target: mechanism.target ?? null } as Record<string, unknown>,
  });

  // Once we have acted, remember how — and treat future mail as bulk noise.
  await senderProfileRepository.setUnsubscribe({
    userId,
    email,
    url: mechanism.target,
    method: mechanism.method,
    now: new Date(),
  });

  let archived = 0;
  if (archiveThread && threadId) {
    archived = await archiveThreadMessages({ userId, threadId });
  }

  return { method: mechanism.method, status, target: mechanism.target, archived, note };
}
