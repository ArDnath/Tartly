"use client";

import { OnboardingLayout } from "@/components/onboarding/onboarding-layout";
import { OnboardingProvider } from "@/components/onboarding/onboarding-provider";
import { CreateProfileStep } from "@/components/onboarding/steps/create-profile-step";
import { ONBOARDING_STATUS } from "@/lib/onboarding/types";

export const DevProfileHarness = () => (
  <OnboardingProvider
    initialState={{
      status: ONBOARDING_STATUS.PROFILE_CREATION,
      previousStatus: null,
      direction: "forward",
      jobTitle: null,
      avatarUrl: null,
      connectedEmailProvider: null,
      connectedCalendarProvider: null,
      calendarTimezone: null,
      installedApps: [],
      invitedEmails: [],
      completedAt: null,
    }}
    user={{
      name: "Ada Lovelace",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      image: null,
    }}
  >
    <OnboardingLayout>
      <CreateProfileStep />
    </OnboardingLayout>
  </OnboardingProvider>
);
