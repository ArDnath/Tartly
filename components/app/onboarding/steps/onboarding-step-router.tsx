"use client";

import { CalendarSetupStep } from "@/components/app/onboarding/steps/calendar-setup-step";
import { CreateProfileStep } from "@/components/app/onboarding/steps/create-profile-step";
import { SyncEmailStep } from "@/components/app/onboarding/steps/sync-email-step";
import { ONBOARDING_STATUS, type OnboardingStatus } from "@/lib/onboarding/types";

export const OnboardingStepRouter = ({ status }: { status: OnboardingStatus }) => {
  switch (status) {
    case ONBOARDING_STATUS.PROFILE_CREATION:
      return <CreateProfileStep />;
    case ONBOARDING_STATUS.SYNC_EMAIL:
      return <SyncEmailStep />;
    case ONBOARDING_STATUS.CALENDAR_SETUP:
      return <CalendarSetupStep />;
    default:
      return null;
  }
};
