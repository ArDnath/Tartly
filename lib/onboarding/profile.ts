export type OnboardingProfileNames = {
  firstName: string;
  lastName: string;
};

/**
 * Google gives Better Auth one display name. Keep the split deterministic so
 * the profile step can be pre-filled without asking the user to retype it.
 */
export function splitDisplayName(displayName: string): OnboardingProfileNames {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);

  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}
