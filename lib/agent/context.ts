import "server-only";

import { calendarPersistenceRepository } from "@/lib/repositories/calendar-persistence";
import { getAutonomySettings, type Autonomy } from "@/lib/settings/autonomy";

/**
 * AgentContext — the server-owned description of *who* the agent is acting for
 * and *what* it is allowed to do. It is built from the authenticated session
 * and persisted settings, never from the request body. The model cannot read,
 * set, or override any field here.
 */

export interface AgentPermissions {
  canRead: boolean;
  canWrite: boolean;
  /** External side effects (send/forward/delete). Off until Phase 3. */
  canSend: boolean;
  requireConfirmationForSideEffects: boolean;
  /**
   * Even when true, side effects still route through a server-verified pending
   * action; the model's decision to call a tool is never treated as consent.
   */
  allowAutonomousSideEffects: boolean;
  autonomy: Autonomy;
}

export interface AgentContext {
  userId: string;
  conversationId: string;
  requestId: string;
  /** Set when the user is looking at a specific thread/message. */
  currentThreadId?: string;
  currentEmailId?: string;
  /**
   * Set only while executing a *confirmed* pending action. A side-effect tool
   * refuses to run without it, so there is no code path from the model to a
   * send that bypasses the server-verified confirmation transition.
   */
  pendingActionId?: string;
  /** Server-derived key that makes the confirmed side effect at-most-once. */
  idempotencyKey?: string;
  permissions: AgentPermissions;
  locale: string;
  timezone: string;
  now: Date;
}

export const DEFAULT_AGENT_LOCALE = "en";
export const DEFAULT_AGENT_TIMEZONE = "UTC";

function defaultPermissions(): AgentPermissions {
  return {
    canRead: true,
    canWrite: true,
    // Side effects (send/forward/delete) are enabled. Whether they run now or
    // wait for a confirmation card is decided below from the mailbox autonomy.
    canSend: true,
    requireConfirmationForSideEffects: true,
    allowAutonomousSideEffects: false,
    autonomy: "copilot",
  };
}

export async function buildAgentContext(input: {
  userId: string;
  conversationId: string;
  requestId: string;
  currentThreadId?: string | null;
  currentEmailId?: string | null;
}): Promise<AgentContext> {
  const { userId } = input;

  const [timezone, autonomy] = await Promise.all([
    calendarPersistenceRepository.findSettingsTimezoneByUser(userId),
    getAutonomySettings(userId),
  ]);

  // Copilot always asks before a side effect; Autopilot lets the agent execute
  // them directly. Even in Autopilot every execution still runs through the
  // server-owned action record (audit + idempotency) — see the chat route's
  // autonomous handler — so the model never holds a raw send credential.
  const mode = autonomy.mailboxAutonomy ?? "copilot";

  const permissions: AgentPermissions = {
    ...defaultPermissions(),
    autonomy: mode,
    allowAutonomousSideEffects: mode === "autopilot",
  };

  return {
    userId,
    conversationId: input.conversationId,
    requestId: input.requestId,
    ...(input.currentThreadId ? { currentThreadId: input.currentThreadId } : {}),
    ...(input.currentEmailId ? { currentEmailId: input.currentEmailId } : {}),
    permissions,
    locale: DEFAULT_AGENT_LOCALE,
    timezone: timezone ?? DEFAULT_AGENT_TIMEZONE,
    now: new Date(),
  };
}
