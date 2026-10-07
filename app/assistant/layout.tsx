import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app/shell/app-shell";
import { AppSidebar } from "@/components/app/shell/app-sidebar";
import { getOrCreateOnboardingState } from "@/lib/onboarding/server";
import { ONBOARDING_STATUS } from "@/lib/onboarding/types";
import { requireSession } from "@/lib/session";

/**
 * Agent chat shell: the same session + onboarding guards and app frame as the
 * mail screens, so `/assistant` feels like part of the product rather than a
 * separate tool.
 */
export default async function AssistantLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireSession();
  const state = await getOrCreateOnboardingState(session.user.id);

  if (state.status !== ONBOARDING_STATUS.COMPLETED) {
    redirect("/onboarding");
  }

  const userImage = state.avatarUrl ?? session.user.image ?? null;

  return (
    <AppShell
      sidebar={
        <AppSidebar
          user={{
            name: session.user.name,
            image: userImage,
          }}
        />
      }
    >
      {children}
    </AppShell>
  );
}
