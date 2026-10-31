"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ONBOARDING_COMPLETION_PATH } from "@/lib/onboarding/constants";
import type { OnboardingSnapshot } from "@/lib/onboarding/types";

export type AdvanceStepInput = {
  action?: "complete" | "skip";
  data?: {
    firstName?: string;
    lastName?: string;
    jobTitle?: string;
    image?: string;
  };
};

export type OnboardingUser = {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  image: string | null;
};

type OnboardingContextValue = {
  state: OnboardingSnapshot;
  user: OnboardingUser;
  isNavigating: boolean;
  /** True when the Google connect flow bounced back with an error. */
  syncEmailError: boolean;
  /** Raw provider error code/description from the failed connect, if any. */
  syncEmailErrorDetail?: string;
  /** Server truth: Entra ID credentials are configured on this deployment. */
  outlookAvailable: boolean;
  advance: (input?: AdvanceStepInput) => Promise<void>;
  goBack: () => Promise<void>;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within <OnboardingProvider>");
  }
  return context;
}

export function OnboardingProvider({
  initialState,
  user: initialUser,
  syncEmailError: initialSyncEmailError = false,
  syncEmailErrorDetail,
  outlookAvailable = false,
  children,
}: {
  initialState: OnboardingSnapshot;
  user: OnboardingUser;
  syncEmailError?: boolean;
  syncEmailErrorDetail?: string;
  outlookAvailable?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<OnboardingSnapshot>(initialState);
  const [user, setUser] = useState<OnboardingUser>(initialUser);
  const [isNavigating, setIsNavigating] = useState(false);

  const advance = useCallback(
    async (input?: AdvanceStepInput) => {
      setIsNavigating(true);
      try {
        const response = await fetch("/api/onboarding/advance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({
            action: input?.action ?? "complete",
            data: input?.data ?? {},
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to advance onboarding");
        }

        const payload = (await response.json()) as {
          state: OnboardingSnapshot;
          justCompleted: boolean;
        };

        if (payload.justCompleted) {
          // Hand off to Mail, which plays the welcome overlay and streams the
          // suggested first-session path into the assistant chat.
          router.replace(ONBOARDING_COMPLETION_PATH);
          return;
        }

        setState(payload.state);

        if (input?.data?.firstName || input?.data?.lastName) {
          setUser((current) => {
            const firstName =
              input.data?.firstName?.trim() ?? current.firstName.trim();
            const lastName =
              input.data?.lastName?.trim() ?? current.lastName.trim();

            return {
              ...current,
              name: `${firstName} ${lastName}`.trim(),
              firstName,
              lastName,
              image: input.data?.image ?? current.image,
            };
          });
        }
      } catch (error) {
        console.error("[onboarding] failed to advance", error);
      } finally {
        setIsNavigating(false);
      }
    },
    [router],
  );

  const goBack = useCallback(async () => {
    setIsNavigating(true);
    try {
      const response = await fetch("/api/onboarding/back", {
        method: "POST",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) {
        throw new Error("Failed to go back");
      }
      const payload = (await response.json()) as {
        state: OnboardingSnapshot;
      };
      setState(payload.state);
    } catch (error) {
      console.error("[onboarding] failed to go back", error);
    } finally {
      setIsNavigating(false);
    }
  }, []);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      state,
      user,
      isNavigating,
      syncEmailError: initialSyncEmailError,
      syncEmailErrorDetail,
      outlookAvailable,
      advance,
      goBack,
    }),
    [
      state,
      user,
      isNavigating,
      initialSyncEmailError,
      syncEmailErrorDetail,
      outlookAvailable,
      advance,
      goBack,
    ],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}
