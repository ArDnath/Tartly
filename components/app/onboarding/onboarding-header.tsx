"use client";

import { ChevronLeft } from "lucide-react";

import { Button } from "@/components/ui/button";

export const OnboardingHeader = ({
  onBack,
  isBackDisabled,
}: {
  onBack?: () => void;
  isBackDisabled?: boolean;
}) => (
  <header className="relative flex w-full items-center justify-between p-8 max-sm:px-4">
    <div className="flex min-w-0 items-center">
      {onBack ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Go back"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onBack();
          }}
          disabled={isBackDisabled}
          className="text-muted-foreground"
        >
          <ChevronLeft className="size-4" />
        </Button>
      ) : null}
    </div>
  </header>
);
