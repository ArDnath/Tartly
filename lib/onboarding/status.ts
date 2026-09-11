import {
  ONBOARDING_STATUS,
  type OnboardingStatus,
} from "@/lib/onboarding/types";

/**
 * The linear, single-tenant onboarding order.
 *
 * Twenty branches on `workspaceMembersCount` and plan state because a
 * workspace can have many members. Here there is exactly one tenant and one
 * user, so the flow is a straight line.
 */
export const ONBOARDING_STEP_ORDER: readonly OnboardingStatus[] = [
  ONBOARDING_STATUS.PROFILE_CREATION,
  ONBOARDING_STATUS.SYNC_EMAIL,
  ONBOARDING_STATUS.CALENDAR_SETUP,
  ONBOARDING_STATUS.COMPLETED,
] as const;

/**
 * Steps that were once in the linear flow but have since been removed. A row
 * persisted with one of these statuses must keep moving forward to its
 * successor — without this, `indexOf` returns -1 and the machine would loop
 * the user back to the very first step.
 */
const RETIRED_ONBOARDING_STATUS_SUCCESSOR: Partial<
  Record<OnboardingStatus, OnboardingStatus>
> = {
  [ONBOARDING_STATUS.APPS_INSTALLATION]: ONBOARDING_STATUS.COMPLETED,
  [ONBOARDING_STATUS.INVITE_TEAM]: ONBOARDING_STATUS.COMPLETED,
  [ONBOARDING_STATUS.BOOK_CALL]: ONBOARDING_STATUS.COMPLETED,
};

/**
 * Maps a retired status to the step that replaced it, leaving live statuses
 * untouched. Callers should normalize before indexing into the step order.
 */
export function normalizeOnboardingStatus(
  status: OnboardingStatus,
): OnboardingStatus {
  return RETIRED_ONBOARDING_STATUS_SUCCESSOR[status] ?? status;
}

export const FIRST_ONBOARDING_STATUS: OnboardingStatus =
  ONBOARDING_STATUS.PROFILE_CREATION;

export function getNextOnboardingStatus(
  current: OnboardingStatus,
): OnboardingStatus {
  // A retired step advances straight to the step that replaced it.
  const successor = RETIRED_ONBOARDING_STATUS_SUCCESSOR[current];
  if (successor) return successor;

  const index = ONBOARDING_STEP_ORDER.indexOf(current);
  if (index < 0) return FIRST_ONBOARDING_STATUS;
  return ONBOARDING_STEP_ORDER[
    Math.min(index + 1, ONBOARDING_STEP_ORDER.length - 1)
  ];
}

export function getPreviousOnboardingStatus(
  current: OnboardingStatus,
): OnboardingStatus | null {
  const target = normalizeOnboardingStatus(current);
  const index = ONBOARDING_STEP_ORDER.indexOf(target);

  if (index <= 0) return null;
  return ONBOARDING_STEP_ORDER[index - 1] ?? null;
}

/** Human-readable progress, e.g. "Step 2 of 5". */
export const ONBOARDING_VISIBLE_STEPS: readonly OnboardingStatus[] =
  ONBOARDING_STEP_ORDER.filter(
    (status) => status !== ONBOARDING_STATUS.COMPLETED,
  );

export function getOnboardingStepIndex(status: OnboardingStatus): number {
  const index = ONBOARDING_VISIBLE_STEPS.indexOf(
    normalizeOnboardingStatus(status),
  );
  return index < 0 ? ONBOARDING_VISIBLE_STEPS.length : index;
}

export type OnboardingStepMeta = {
  status: OnboardingStatus;
  title: string;
  subtitle: string;
};

/** Titles shown while the step is prefetching / animating. */
export const ONBOARDING_STEP_META: Record<OnboardingStatus, OnboardingStepMeta> =
  {
    [ONBOARDING_STATUS.PROFILE_CREATION]: {
      status: ONBOARDING_STATUS.PROFILE_CREATION,
      title: "Create profile",
      subtitle: "How you'll appear to teammates and agents.",
    },
    [ONBOARDING_STATUS.SYNC_EMAIL]: {
      status: ONBOARDING_STATUS.SYNC_EMAIL,
      title: "Sync your inbox",
      subtitle: "Connect email and calendar to populate your workspace.",
    },
    [ONBOARDING_STATUS.CALENDAR_SETUP]: {
      status: ONBOARDING_STATUS.CALENDAR_SETUP,
      title: "Meetings",
      subtitle: "When can your assistant book time?",
    },
    [ONBOARDING_STATUS.APPS_INSTALLATION]: {
      status: ONBOARDING_STATUS.APPS_INSTALLATION,
      title: "Install your first apps",
      subtitle: "Get the most out of your workspace by installing some apps.",
    },
    [ONBOARDING_STATUS.INVITE_TEAM]: {
      status: ONBOARDING_STATUS.INVITE_TEAM,
      title: "Invite your team",
      subtitle: "Get the most out of your workspace by inviting your team.",
    },
    [ONBOARDING_STATUS.BOOK_CALL]: {
      status: ONBOARDING_STATUS.BOOK_CALL,
      title: "Talk to our team",
      subtitle:
        "Book a 30-minute call and we'll help you get production-ready.",
    },
    [ONBOARDING_STATUS.COMPLETED]: {
      status: ONBOARDING_STATUS.COMPLETED,
      title: "You're all set",
      subtitle: "Your workspace is ready.",
    },
  };
