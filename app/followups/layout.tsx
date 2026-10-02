import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell/app-shell";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { getOrCreateOnboardingState } from "@/lib/onboarding/server";
import { ONBOARDING_STATUS } from "@/lib/onboarding/types";
import { requireSession } from "@/lib/session";

export default async function FollowupsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireSession();
  const state = await getOrCreateOnboardingState(session.user.id);

  if (state.status !== ONBOARDING_STATUS.COMPLETED) {
    redirect("/onboarding");
  }

  return (
    <AppShell
      sidebar={
        <AppSidebar
          user={{
            name: session.user.name,
            image: state.avatarUrl ?? session.user.image ?? null,
          }}
        />
      }
    >
      {children}
    </AppShell>
  );
}
