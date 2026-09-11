import { redirect } from "next/navigation";
import { after } from "next/server";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell/app-shell";
import { InboxSidebar } from "@/components/inbox/inbox-sidebar";
import { kickDrain } from "@/lib/email-operator/drain";
import { ensureMailboxForUser } from "@/lib/email-operator/mailbox";
import { getInboxCounts } from "@/lib/inbox/service";
import { getOrCreateOnboardingState } from "@/lib/onboarding/server";
import { ONBOARDING_STATUS } from "@/lib/onboarding/types";
import { requireSession } from "@/lib/session";

/**
 * Inbox shell: the same session + onboarding guards as `/mail`, sharing the
 * extracted `AppShell`. Opening the inbox also kicks an opportunistic,
 * lock-guarded drain so pending work progresses without cron.
 */
export default async function InboxLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireSession();
  // The onboarding read and the badge counts are independent.
  const [state, counts] = await Promise.all([
    getOrCreateOnboardingState(session.user.id),
    getInboxCounts(session.user.id),
  ]);

  if (state.status !== ONBOARDING_STATUS.COMPLETED) {
    redirect("/onboarding");
  }

  after(async () => {
    try {
      // Self-heal: a user who onboarded before mailbox creation existed gets a
      // mailbox (and a queued initial sync) the first time they open the inbox.
      await ensureMailboxForUser(session.user.id);
      await kickDrain("inbox-open");
    } catch (error) {
      console.warn("[inbox] opportunistic drain failed", error);
    }
  });

  return (
    <AppShell
      sidebar={
        <InboxSidebar
          counts={counts}
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
