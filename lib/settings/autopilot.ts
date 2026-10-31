import "server-only";

import { nanoid } from "nanoid";

import { mailboxRepository } from "@/lib/repositories/mailboxes";
import {
  autopilotRepository,
  type AutopilotUsage,
} from "@/lib/repositories/autopilot";
import {
  applyPolicyPatch,
  defaultAutopilotPolicy,
  policyFromRow,
  AUTOPILOT_POLICY_VERSION,
  type AutopilotPolicy,
  type AutopilotPolicyPatch,
} from "@/lib/settings/autopilot-policy";

// Pure Autopilot policy semantics (defaults / normalization / guard ordering /
// reason labels) live in `@/lib/settings/autopilot-policy`; this module owns the
// persistence-backed orchestration and re-exports the pure surface so existing
// imports keep working.

export {
  AUTOPILOT_CATEGORIES,
  AUTOPILOT_POLICY_VERSION,
  AUTOPILOT_REASON_LABELS,
  autopilotReasonLabel,
  defaultAutopilotPolicy,
  evaluateAutopilotGate,
  isWithinSendWindow,
  autopilotWindowStart,
  policyFromRow,
  applyPolicyPatch,
} from "@/lib/settings/autopilot-policy";
export type {
  AutopilotCategory,
  AutopilotConfidence,
  AutopilotGateInput,
  AutopilotGateReason,
  AutopilotGateResult,
  AutopilotMode,
  AutopilotPolicy,
  AutopilotPolicyPatch,
} from "@/lib/settings/autopilot-policy";

export type { AutopilotUsage };

export { autopilotRepository };

async function resolveMailboxId(userId: string): Promise<string | null> {
  const mailbox = await mailboxRepository.findByUser(userId);
  return mailbox?.id ?? null;
}

/**
 * Returns the mailbox's policy, creating the disabled default on first read.
 * When the user has no mailbox yet, returns a synthesized default (not
 * persisted) so the settings UI can render before Gmail is connected.
 */
export async function getAutopilotPolicyForMailbox(
  userId: string,
  mailboxId: string,
): Promise<AutopilotPolicy> {
  const existing = await autopilotRepository.findPolicyByMailboxId(mailboxId);
  if (existing) return policyFromRow(existing);

  const created = await autopilotRepository.ensurePolicy({
    id: nanoid(),
    userId,
    mailboxId,
    policyVersion: AUTOPILOT_POLICY_VERSION,
  });
  return policyFromRow(created);
}

export async function getAutopilotPolicy(userId: string): Promise<AutopilotPolicy> {
  const mailboxId = await resolveMailboxId(userId);
  if (!mailboxId) return defaultAutopilotPolicy();
  return getAutopilotPolicyForMailbox(userId, mailboxId);
}

export async function setAutopilotPolicyForMailbox(
  userId: string,
  mailboxId: string,
  patch: AutopilotPolicyPatch,
  now = new Date(),
): Promise<AutopilotPolicy> {
  const current = await getAutopilotPolicyForMailbox(userId, mailboxId);
  const clamped = applyPolicyPatch(current, patch);
  const updated = await autopilotRepository.updatePolicy(
    mailboxId,
    clamped,
    now,
  );
  return policyFromRow(updated);
}

export async function setAutopilotPolicy(
  userId: string,
  patch: AutopilotPolicyPatch,
  now = new Date(),
): Promise<AutopilotPolicy> {
  const mailboxId = await resolveMailboxId(userId);
  if (!mailboxId) {
    throw new Error("No connected mailbox to configure autopilot.");
  }
  return setAutopilotPolicyForMailbox(userId, mailboxId, patch, now);
}

/**
 * Kill switch. Disables the policy and optionally forces the mailbox back to
 * `copilot` so a UI toggle cannot leave a sendable autonomy in place.
 */
export async function pauseAutopilot(
  userId: string,
  options: { alsoSetCopilot?: boolean } = {},
  now = new Date(),
): Promise<AutopilotPolicy> {
  const mailboxId = await resolveMailboxId(userId);
  if (!mailboxId) return defaultAutopilotPolicy();

  const policy = await setAutopilotPolicyForMailbox(
    userId,
    mailboxId,
    { enabled: false },
    now,
  );

  if (options.alsoSetCopilot) {
    const { setMailboxAutonomy } = await import("@/lib/settings/autonomy");
    await setMailboxAutonomy(userId, "copilot");
  }

  return policy;
}

/** A sender is known when they are a contact or we have mailed them before. */
export async function isKnownSender({
  userId,
  email,
}: {
  userId: string;
  email: string | null;
}): Promise<boolean> {
  if (!email) return false;
  if (await autopilotRepository.contactExists(userId, email)) return true;
  return autopilotRepository.hasPriorOutboundTo(userId, email);
}
