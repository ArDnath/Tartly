/**
 * Single-tenant onboarding domain types.
 *
 * Ported from Twenty's `onboarding-status.enum.ts` but trimmed: there is no
 * `WORKSPACE_ACTIVATION` (no workspace to create) and no `PLAN_REQUIRED`
 * (no billing in this app).
 */
export const ONBOARDING_STATUS = {
  PROFILE_CREATION: "PROFILE_CREATION",
  SYNC_EMAIL: "SYNC_EMAIL",
  // Appended after SYNC_EMAIL so the existing PROFILE_CREATION → SYNC_EMAIL
  // path is untouched. Optional: auto-advances when no calendar scope was
  // granted, and the user can also skip it explicitly.
  CALENDAR_SETUP: "CALENDAR_SETUP",
  APPS_INSTALLATION: "APPS_INSTALLATION",
  INVITE_TEAM: "INVITE_TEAM",
  BOOK_CALL: "BOOK_CALL",
  COMPLETED: "COMPLETED",
} as const;

export type OnboardingStatus =
  (typeof ONBOARDING_STATUS)[keyof typeof ONBOARDING_STATUS];

export const ONBOARDING_STATUSES = Object.values(
  ONBOARDING_STATUS,
) as OnboardingStatus[];

export function isOnboardingStatus(value: unknown): value is OnboardingStatus {
  return (
    typeof value === "string" &&
    (ONBOARDING_STATUSES as string[]).includes(value)
  );
}

export type OnboardingNavigationDirection = "forward" | "backward";

/**
 * Controls what happens to the reversible-step history when a step advances,
 * exactly like Twenty's `OnboardingStepHistoryEffect`.
 */
export type OnboardingStepHistoryEffect =
  | "recordAsReversible"
  | "clearAfterIrreversibleStep"
  | "leaveUnchanged";

/** A step the user can navigate back to. */
export type ReversibleOnboardingStep = Exclude<
  OnboardingStatus,
  "COMPLETED"
>;

export type WelcomeTitleFlight = {
  translateXInPx: number;
  translateYInPx: number;
  scale: number;
  transformOriginXInPx: number;
};

export type WorkspaceSetupChatOutcome =
  | "STARTED"
  | "ALREADY_STARTED"
  | "UNAVAILABLE";

export type WorkspaceSetupChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  hidden: boolean;
  createdAt: string;
};

export type InstallableApp = {
  universalIdentifier: string;
  label: string;
  description: string;
};

export type OnboardingSnapshot = {
  status: OnboardingStatus;
  previousStatus: OnboardingStatus | null;
  direction: OnboardingNavigationDirection;
  jobTitle: string | null;
  avatarUrl: string | null;
  connectedEmailProvider: string | null;
  connectedCalendarProvider: string | null;
  calendarTimezone: string | null;
  installedApps: string[];
  invitedEmails: string[];
  completedAt: string | null;
};
