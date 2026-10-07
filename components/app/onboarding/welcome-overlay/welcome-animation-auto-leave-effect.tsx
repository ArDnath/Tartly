"use client";

import { useEffect, useRef } from "react";

import { measureWelcomeTitleFlight } from "@/components/app/onboarding/welcome-overlay/welcome-title-flight";
import { WELCOME_TITLE_HANDOFF_TARGET_ELEMENT_ID } from "@/lib/onboarding/constants";
import type { WelcomeTitleFlight } from "@/lib/onboarding/types";

const WELCOME_HOLD_MIN_DURATION_MS = 2900;
const WELCOME_HOLD_MAX_DURATION_MS = 5000;

/**
 * Holds the welcome title for a beat, then triggers the "flight" into the
 * chat preamble once the handoff target is on screen and fonts have loaded.
 */
export const WelcomeAnimationAutoLeaveEffect = ({
  onLeave,
}: {
  onLeave: (flight: WelcomeTitleFlight | null) => void;
}) => {
  const onLeaveRef = useRef(onLeave);

  useEffect(() => {
    onLeaveRef.current = onLeave;
  }, [onLeave]);

  useEffect(() => {
    let hasFired = false;

    const leave = () => {
      if (hasFired) return;
      hasFired = true;
      onLeaveRef.current(measureWelcomeTitleFlight());
    };

    const capTimeoutId = setTimeout(leave, WELCOME_HOLD_MAX_DURATION_MS);
    const minHoldTimeoutId = setTimeout(() => {
      const hasHandoffTarget = Boolean(
        document.getElementById(WELCOME_TITLE_HANDOFF_TARGET_ELEMENT_ID),
      );
      if (!hasHandoffTarget) return;

      if (document.fonts) {
        void document.fonts.ready.then(leave);
      } else {
        leave();
      }
    }, WELCOME_HOLD_MIN_DURATION_MS);

    return () => {
      clearTimeout(capTimeoutId);
      clearTimeout(minHoldTimeoutId);
      hasFired = true;
    };
  }, []);

  return null;
};
