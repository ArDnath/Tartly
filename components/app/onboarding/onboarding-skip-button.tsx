"use client";

import { Button } from "@/components/ui/button";

export const OnboardingSkipButton = ({
  onClick,
  disabled,
  label = "Skip",
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) => (
  <Button
    type="button"
    variant="outline"
    onClick={onClick}
    disabled={disabled}
    className="text-muted-foreground"
  >
    {label}
  </Button>
);
