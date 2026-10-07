"use client";

import type { ReactNode } from "react";

import { OnboardingHeader } from "@/components/app/onboarding/onboarding-header";

export const OnboardingLayout = ({
  children,
  onBack,
  isBackDisabled,
}: {
  children: ReactNode;
  onBack?: () => void;
  isBackDisabled?: boolean;
}) => (
  <div className="flex h-dvh w-full flex-col bg-canvas">
    <OnboardingHeader onBack={onBack} isBackDisabled={isBackDisabled} />
    {children}
  </div>
);
