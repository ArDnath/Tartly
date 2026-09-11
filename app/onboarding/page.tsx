import { redirect } from "next/navigation";

import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { OnboardingProvider } from "@/components/onboarding/onboarding-provider";
import { splitDisplayName } from "@/lib/onboarding/profile";
import { getOrCreateOnboardingState } from "@/lib/onboarding/server";
import { ONBOARDING_STATUS } from "@/lib/onboarding/types";
import { requireSession } from "@/lib/session";

/**
 * Onboarding entry point. The step state machine lives server-side; this page
 * seeds the client provider from the database and hands off to the animated
 * multi-step flow.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{
    syncEmail?: string;
    error?: string;
    error_description?: string;
  }>;
}) {
  const session = await requireSession();
  const state = await getOrCreateOnboardingState(session.user.id);
  const { syncEmail, error, error_description: errorDescription } =
    await searchParams;

  if (state.status === ONBOARDING_STATUS.COMPLETED) {
    redirect("/mail");
  }

  const { firstName, lastName } = splitDisplayName(session.user.name);

  return (
    <OnboardingProvider
      initialState={state}
      syncEmailError={syncEmail === "error"}
      syncEmailErrorDetail={
        error ? (errorDescription ? `${error}: ${errorDescription}` : error) : undefined
      }
      user={{
        name: session.user.name,
        firstName,
        lastName,
        email: session.user.email,
        image: state.avatarUrl ?? session.user.image ?? null,
      }}
    >
      <OnboardingFlow />
    </OnboardingProvider>
  );
}
