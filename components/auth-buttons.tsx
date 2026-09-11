"use client";

import { Loader2, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { GoogleIcon } from "@/components/icons/google-icon";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

/**
 * Shared sign-out flow: hits the fast server endpoint (which clears cookies
 * immediately and defers session deletion), falls back to Better Auth, then
 * sends the user to `/auth`.
 */
export function useSignOut() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const signOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      const response = await fetch("/api/sign-out", { method: "POST" });
      if (!response.ok) throw new Error("fast sign-out failed");
    } catch {
      // Fallback: synchronous Better Auth sign-out.
      await authClient.signOut().catch(() => {});
    }
    router.replace("/auth");
    router.refresh();
  }, [router]);

  return { signOut, isSigningOut };
}

export function GoogleSignInButton() {
  const [isLoading, setIsLoading] = useState(false);

  return (
    <button
      type="button"
      disabled={isLoading}
      aria-busy={isLoading}
      onClick={async () => {
        setIsLoading(true);
        try {
          const result = await authClient.signIn.social({
            provider: "google",
            callbackURL: "/onboarding",
            // Keep the OAuth URL out of the browser history. The onboarding
            // back button must never return to an in-progress OAuth request.
            disableRedirect: true,
          });

          if (result.data?.url) {
            window.location.replace(result.data.url);
            return;
          }

          console.error("[auth] Google sign-in did not return a URL", result.error);
        } catch (error) {
          console.error("[auth] Google sign-in failed", error);
        } finally {
          setIsLoading(false);
        }
      }}
      className="flex h-12 w-full items-center justify-center gap-3 rounded-lg border border-neutral-300 bg-white px-7 text-sm font-semibold text-neutral-900 shadow-sm transition-[background-color,border-color,box-shadow,color] duration-300 ease-out hover:border-neutral-900 hover:bg-neutral-900 hover:text-white hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-70 sm:h-14 sm:text-base"
    >
      {isLoading ? (
        <span className="size-4 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900" aria-hidden="true" />
      ) : (
        <GoogleIcon className="size-[18px]" />
      )}
      {isLoading ? "Opening Google…" : "Continue with Google"}
    </button>
  );
}

export function SignOutButton({
  iconOnly = false,
  className,
}: {
  /** Render just the icon (for the collapsed sidebar). */
  iconOnly?: boolean;
  className?: string;
} = {}) {
  const { signOut, isSigningOut } = useSignOut();

  return (
    <button
      type="button"
      disabled={isSigningOut}
      aria-busy={isSigningOut}
      aria-label={iconOnly ? "Sign out" : undefined}
      title={iconOnly ? "Sign out" : undefined}
      onClick={() => void signOut()}
      className={cn(
        "flex h-9 items-center justify-center gap-2 rounded-lg border border-border text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-70",
        iconOnly ? "w-9" : "w-full px-4",
        className,
      )}
    >
      {iconOnly ? (
        isSigningOut ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <LogOut className="size-4" />
        )
      ) : isSigningOut ? (
        "Signing out…"
      ) : (
        "Sign out"
      )}
    </button>
  );
}
