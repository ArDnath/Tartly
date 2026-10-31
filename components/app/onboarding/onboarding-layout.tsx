"use client";

import type { ReactNode } from "react";

import { OnboardingHeader } from "@/components/app/onboarding/onboarding-header";
import { OnboardingSignOutButton } from "@/components/app/onboarding/onboarding-sign-out-button";

export const OnboardingLayout = ({
  children,
  onBack,
  isBackDisabled,
  isSignOutDisabled,
}: {
  children: ReactNode;
  onBack?: () => void;
  isBackDisabled?: boolean;
  isSignOutDisabled?: boolean;
}) => (
  <div className="flex h-dvh w-full flex-col bg-canvas">
    <OnboardingHeader onBack={onBack} isBackDisabled={isBackDisabled} />
    {children}
    {/*
      Persistent escape hatch: the user may have signed in with the wrong
      Google account, so sign-out must be reachable from every step.
    */}
    <footer className="flex w-full shrink-0 items-center px-8 py-4 max-sm:px-4">
      <OnboardingSignOutButton disabled={isSignOutDisabled} />
    </footer>
  </div>
);
