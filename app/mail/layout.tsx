import { redirect } from "next/navigation";
import { after } from "next/server";
import { Suspense, type ReactNode } from "react";

import { AiChatProvider } from "@/components/ai-chat/ai-chat-provider";
import { AppShell } from "@/components/app-shell/app-shell";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { MailPrefetch } from "@/components/mail/mail-prefetch";
import { MailWelcomeOverlayGate } from "@/components/mail/mail-welcome-overlay-gate";
import { kickDrain } from "@/lib/email-operator/drain";
import { ensureMailboxForUser } from "@/lib/email-operator/mailbox";
import { getOrCreateOnboardingState } from "@/lib/onboarding/server";
import { ONBOARDING_STATUS } from "@/lib/onboarding/types";
import { requireSession } from "@/lib/session";

/**
 * Live mail client shell: the same session + onboarding guards as `/inbox`,
 * sharing the extracted `AppShell`. Opening `/mail` also runs the best-effort
 * mailbox self-heal (for users who onboarded before mailbox creation existed)
 * and kicks the opportunistic, lock-guarded drain.
 *
 * The mail route also hosts the first-run welcome overlay and the screen-level
 * chat provider the assistant dialog reuses, so onboarding can hand off to
 * `/mail?welcome=1` and stream the welcome conversation into the chat.
 */
export default async function MailLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireSession();
  const state = await getOrCreateOnboardingState(session.user.id);

  if (state.status !== ONBOARDING_STATUS.COMPLETED) {
    redirect("/onboarding");
  }

  after(async () => {
    try {
      await ensureMailboxForUser(session.user.id);
      await kickDrain("mail-open");
    } catch (error) {
      console.warn("[mail] opportunistic sync failed", error);
    }
  });

  const userImage = state.avatarUrl ?? session.user.image ?? null;

  return (
    <AiChatProvider userName={session.user.name} userImage={userImage}>
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
        {/* Streamed, not awaited: the shell above paints immediately while the
            Gmail read resolves, then seeds the store. */}
        <Suspense fallback={null}>
          <MailPrefetch userId={session.user.id} />
        </Suspense>
        {children}
      </AppShell>
      <MailWelcomeOverlayGate />
    </AiChatProvider>
  );
}
