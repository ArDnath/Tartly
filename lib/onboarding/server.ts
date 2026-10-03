import "server-only";

import { cache } from "react";

import {
  FIRST_ONBOARDING_STATUS,
  getNextOnboardingStatus,
  getPreviousOnboardingStatus,
  normalizeOnboardingStatus,
} from "@/lib/onboarding/status";
import {
  isOnboardingStatus,
  ONBOARDING_STATUS,
  type OnboardingNavigationDirection,
  type OnboardingSnapshot,
  type OnboardingStatus,
  type OnboardingStepHistoryEffect,
  type ReversibleOnboardingStep,
} from "@/lib/onboarding/types";
import {
  onboardingRepository,
  type OnboardingState as OnboardingStateRow,
} from "@/lib/repositories/onboarding";
import { agentChatRepository } from "@/lib/repositories/agent-chat";

function toSnapshot(row: OnboardingStateRow): OnboardingSnapshot {
  return {
    status: normalizeOnboardingStatus(
      isOnboardingStatus(row.status) ? row.status : FIRST_ONBOARDING_STATUS,
    ),
    previousStatus: isOnboardingStatus(row.previousStatus)
      ? normalizeOnboardingStatus(row.previousStatus)
      : null,
    direction:
      row.navigationDirection === "backward" ? "backward" : "forward",
    jobTitle: row.jobTitle,
    avatarUrl: row.avatarUrl,
    connectedEmailProvider: row.connectedEmailProvider,
    connectedCalendarProvider: row.connectedCalendarProvider,
    calendarTimezone: row.calendarTimezone,
    installedApps: row.installedApps ?? [],
    invitedEmails: row.invitedEmails ?? [],
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

async function readRow(userId: string): Promise<OnboardingStateRow> {
  const existing = await onboardingRepository.findByUser(userId);

  if (existing) {
    return existing;
  }

  const inserted = await onboardingRepository.insertIfAbsent({
    userId,
    status: FIRST_ONBOARDING_STATUS,
  });

  if (inserted) {
    return inserted;
  }

  // Lost a race with a concurrent request; read what the winner wrote.
  const raced = await onboardingRepository.findByUser(userId);

  return raced as OnboardingStateRow;
}

/**
 * Reads the user's onboarding row, creating it on first visit. Single-tenant,
 * so there is no workspace to resolve — `userId` is the whole scope.
 *
 * Cached per request: the layout guard and every page underneath it read the
 * same snapshot, so the query runs once per navigation rather than once per
 * segment.
 */
export const getOrCreateOnboardingState = cache(
  async (userId: string): Promise<OnboardingSnapshot> =>
    toSnapshot(await readRow(userId)),
);

export const getOnboardingState = cache(
  async (userId: string): Promise<OnboardingSnapshot | null> => {
    const row = await onboardingRepository.findByUser(userId);

    return row ? toSnapshot(row) : null;
  },
);

function getNextPreviousStatus({
  stepHistoryEffect,
  currentStatus,
  currentPreviousStatus,
}: {
  stepHistoryEffect: OnboardingStepHistoryEffect;
  currentStatus: OnboardingStatus;
  currentPreviousStatus: OnboardingStatus | null;
}): OnboardingStatus | null {
  switch (stepHistoryEffect) {
    case "recordAsReversible":
      return currentStatus;
    case "clearAfterIrreversibleStep":
      return null;
    case "leaveUnchanged":
    default:
      return currentPreviousStatus;
  }
}

export type OnboardingStatusPatch = Partial<{
  jobTitle: string | null;
  avatarUrl: string | null;
  connectedEmailProvider: string | null;
  connectedCalendarProvider: string | null;
  calendarTimezone: string | null;
  installedApps: string[];
  invitedEmails: string[];
}>;

/**
 * Advances the state machine one step. Mirrors Twenty's
 * `useSetNextOnboardingStatus`, including the reversible-step history so the
 * header back button can undo steps that were skipped rather than completed.
 */
export async function advanceOnboarding({
  userId,
  stepHistoryEffect,
  statusPatch,
}: {
  userId: string;
  stepHistoryEffect: OnboardingStepHistoryEffect;
  statusPatch?: OnboardingStatusPatch;
}): Promise<{ snapshot: OnboardingSnapshot; justCompleted: boolean }> {
  const current = await readRow(userId);
  const rawStatus = isOnboardingStatus(current.status)
    ? current.status
    : FIRST_ONBOARDING_STATUS;
  const currentStatus = normalizeOnboardingStatus(rawStatus);
  const currentPreviousStatus = isOnboardingStatus(current.previousStatus)
    ? normalizeOnboardingStatus(current.previousStatus)
    : null;
  const history = (current.reversibleHistory ?? []) as ReversibleOnboardingStep[];

  const nextStatus = getNextOnboardingStatus(currentStatus);
  const justCompleted =
    nextStatus === ONBOARDING_STATUS.COMPLETED &&
    rawStatus !== ONBOARDING_STATUS.COMPLETED;

  const nextPreviousStatus = getNextPreviousStatus({
    stepHistoryEffect,
    currentStatus,
    currentPreviousStatus,
  });

  const nextHistory: string[] =
    stepHistoryEffect === "clearAfterIrreversibleStep"
      ? []
      : stepHistoryEffect === "recordAsReversible" &&
          currentStatus !== ONBOARDING_STATUS.COMPLETED
        ? [...history, currentStatus]
        : history;

  const snapshot = await updateState(userId, {
    status: nextStatus,
    previousStatus: nextPreviousStatus,
    navigationDirection: "forward",
    reversibleHistory: nextHistory,
    ...statusPatch,
    ...(justCompleted ? { completedAt: new Date() } : {}),
  });

  return { snapshot, justCompleted };
}

/**
 * Pops the most recent step without touching browser history. Older rows may
 * not have a reversible history entry, so fall back to the linear step order.
 * This keeps the onboarding back button inside onboarding instead of sending
 * the browser back into the Google OAuth transaction.
 */
export async function goBackOnboarding(
  userId: string,
): Promise<OnboardingSnapshot> {
  const current = await readRow(userId);
  const currentStatus = normalizeOnboardingStatus(
    isOnboardingStatus(current.status) ? current.status : FIRST_ONBOARDING_STATUS,
  );
  // Drop retired steps from the reversible history so "back" can never land on
  // a step that no longer exists in the flow.
  const history = ((current.reversibleHistory ?? []) as string[]).filter(
    (step): step is ReversibleOnboardingStep =>
      isOnboardingStatus(step) && normalizeOnboardingStatus(step) === step,
  );
  const previousStep =
    history[history.length - 1] ?? getPreviousOnboardingStatus(currentStatus);

  if (!previousStep || !isOnboardingStatus(previousStep)) {
    return toSnapshot(current);
  }

  const nextHistory = history.slice(0, -1);

  return updateState(userId, {
    status: previousStep,
    previousStatus:
      nextHistory[nextHistory.length - 1] ??
      getPreviousOnboardingStatus(previousStep),
    navigationDirection: "backward",
    reversibleHistory: nextHistory,
    completedAt: null,
  });
}

/** Persists arbitrary step payloads without advancing the state machine. */
export async function patchOnboardingState(
  userId: string,
  patch: OnboardingStatusPatch,
): Promise<OnboardingSnapshot> {
  await readRow(userId);
  return updateState(userId, patch);
}

async function updateState(
  userId: string,
  patch: Partial<OnboardingStateRow>,
): Promise<OnboardingSnapshot> {
  const updated = await onboardingRepository.updateByUser(userId, patch);

  return toSnapshot(updated);
}

/** Narrow helper used by the chat routes to validate thread ownership. */
export async function userOwnsThread(
  userId: string,
  threadId: string,
): Promise<boolean> {
  const owned = await agentChatRepository.findThreadForUser(userId, threadId);

  return Boolean(owned);
}

export type { OnboardingNavigationDirection };
