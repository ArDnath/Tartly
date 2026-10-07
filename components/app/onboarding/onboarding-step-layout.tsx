"use client";

import type { ReactNode } from "react";

import { TartlyLogo } from "@/components/shared/brand/tartly-logo";
import { ONBOARDING_CONTENT_BLOCK_WIDTH } from "@/lib/onboarding/constants";
import { cn } from "@/lib/utils";

const CONTENT_WIDTH_STYLE = { width: ONBOARDING_CONTENT_BLOCK_WIDTH };

/** Full-height, centered scroll container for a single onboarding step. */
export const OnboardingStepPage = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "flex min-h-0 w-full flex-1 flex-col items-center gap-8 overflow-y-auto bg-canvas px-4 py-8 sm:gap-14 sm:px-8 sm:py-16",
      className,
    )}
  >
    {children}
  </div>
);

export const OnboardingContentBlock = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={cn("flex max-w-full flex-col", className)}
    style={CONTENT_WIDTH_STYLE}
  >
    {children}
  </div>
);

export const OnboardingStepHeading = ({
  children,
}: {
  children: ReactNode;
}) => (
  <OnboardingContentBlock className="gap-4">
    <div className="flex justify-center">
      <TartlyLogo
        alt="Tartly"
        className="pointer-events-none size-12 rounded-lg"
      />
    </div>
    {children}
  </OnboardingContentBlock>
);

export const OnboardingStepTitle = ({
  children,
}: {
  children: ReactNode;
}) => (
  <h1 className="text-xl font-semibold leading-tight text-foreground">
    {children}
  </h1>
);

export const OnboardingStepSubtitle = ({
  children,
}: {
  children: ReactNode;
}) => (
  <p className="text-sm leading-snug text-muted-foreground">{children}</p>
);
