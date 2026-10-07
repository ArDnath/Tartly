"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAiChat } from "@/components/app/ai-chat/ai-chat-provider";
import { openAssistantChat } from "@/components/app/assistant/assistant-events";
import { WelcomeOverlay } from "@/components/app/onboarding/welcome-overlay/welcome-overlay";
import type { WelcomeTitleFlight } from "@/lib/onboarding/types";

/**
 * Plays the halftone welcome overlay over `/mail` when the app is entered from
 * the end of onboarding (`/mail?welcome=1`), and kicks off the streamed welcome
 * reply into the screen-level chat provider mounted by the mail layout.
 *
 * The assistant chat pane is opened behind the overlay so the welcome title has
 * a flight target and the streamed conversation is revealed as the overlay
 * fades out.
 */
export function MailWelcomeOverlay({
  /**
   * Fired once the overlay is on screen (and has therefore painted its own
   * opaque canvas). The gate above uses it to retire the pre-load cover that
   * masked the mail route while this chunk was still loading.
   */
  onMounted,
}: {
  onMounted?: () => void;
}) {
  const searchParams = useSearchParams();
  const { startWelcome, userName, userImage } = useAiChat();
  const showWelcome = searchParams.get("welcome") === "1";

  const [isVisible, setIsVisible] = useState(showWelcome);
  const [isLeaving, setIsLeaving] = useState(false);
  const [flight, setFlight] = useState<WelcomeTitleFlight | null>(null);

  useEffect(() => {
    onMounted?.();
  }, [onMounted]);

  useEffect(() => {
    if (!showWelcome) return;
    void startWelcome();

    // Open the chat behind the overlay so the title can fly into the welcome
    // preamble and the streamed reply is visible when the overlay leaves.
    const openTimeout = setTimeout(openAssistantChat, 0);

    // Consume the flag so a refresh doesn't replay the animation. The overlay
    // stays mounted (state above), so the streamed reply remains on screen.
    const url = new URL(window.location.href);
    if (url.searchParams.has("welcome")) {
      url.searchParams.delete("welcome");
      window.history.replaceState(null, "", url.toString());
    }

    return () => clearTimeout(openTimeout);
  }, [showWelcome, startWelcome]);

  const handleAutoLeave = useCallback(
    (measuredFlight: WelcomeTitleFlight | null) => {
      setFlight(measuredFlight);
      setIsLeaving(true);
    },
    [],
  );

  const handleTeardown = useCallback(() => {
    setIsVisible(false);
    setIsLeaving(false);
    setFlight(null);
  }, []);

  return (
    <WelcomeOverlay
      isVisible={isVisible}
      isLeaving={isLeaving}
      flight={flight}
      userName={userName}
      userImage={userImage}
      onAutoLeave={handleAutoLeave}
      onTeardown={handleTeardown}
    />
  );
}
