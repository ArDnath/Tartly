"use client";

import { Loader2, LogOut } from "lucide-react";

import { useSignOut } from "@/components/app/auth-buttons";
import { Button } from "@/components/ui/button";

/**
 * Escape hatch for the onboarding flow. Rendered once by the onboarding
 * layout so a user who signed in with the wrong account can leave from any
 * step without completing (or undoing) the flow first.
 */
export const OnboardingSignOutButton = ({
  disabled,
}: {
  disabled?: boolean;
}) => {
  const { signOut, isSigningOut } = useSignOut();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled || isSigningOut}
      aria-busy={isSigningOut}
      onClick={() => void signOut()}
      className="text-muted-foreground"
    >
      {isSigningOut ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <LogOut className="size-4" />
      )}
      {isSigningOut ? "Signing out…" : "Sign out"}
    </Button>
  );
};
