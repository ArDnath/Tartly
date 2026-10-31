"use client";

import { OnboardingLayout } from "@/components/app/onboarding/onboarding-layout";
import { useOnboarding } from "@/components/app/onboarding/onboarding-provider";
import { OnboardingStepRouter } from "@/components/app/onboarding/steps/onboarding-step-router";
import { OnboardingTransitionOutlet } from "@/components/app/onboarding/onboarding-transition-outlet";
import { getPreviousOnboardingStatus } from "@/lib/onboarding/status";

/**
 * The onboarding shell: header (with back) plus the animated step area. Step
 * state lives in the server-backed `OnboardingProvider`.
 */
export const OnboardingFlow = () => {
  const { state, goBack, isNavigating } = useOnboarding();

  const hasPreviousStep = getPreviousOnboardingStatus(state.status) !== null;

  return (
    <OnboardingLayout
      onBack={hasPreviousStep ? () => void goBack() : undefined}
      isBackDisabled={isNavigating}
      isSignOutDisabled={isNavigating}
    >
      <OnboardingTransitionOutlet
        stepKey={state.status}
        direction={state.direction}
      >
        <OnboardingStepRouter status={state.status} />
      </OnboardingTransitionOutlet>
    </OnboardingLayout>
  );
};
