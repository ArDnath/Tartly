"use client";

import { motion, useReducedMotion } from "motion/react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { WelcomeAnimationAutoLeaveEffect } from "@/components/onboarding/welcome-overlay/welcome-animation-auto-leave-effect";
import { WelcomeAnimationForcedTeardownEffect } from "@/components/onboarding/welcome-overlay/welcome-animation-forced-teardown-effect";
import { WelcomeHalftoneCanvas } from "@/components/onboarding/welcome-overlay/welcome-halftone-canvas";
import { WelcomePersonChip } from "@/components/onboarding/welcome-overlay/welcome-person-chip";
import {
  WELCOME_TITLE_MESSAGE,
  WELCOME_TITLE_SOURCE_ELEMENT_ID,
} from "@/lib/onboarding/constants";
import type { WelcomeTitleFlight } from "@/lib/onboarding/types";

type WelcomeOverlayProps = {
  isVisible: boolean;
  isLeaving: boolean;
  flight: WelcomeTitleFlight | null;
  userName: string;
  userImage: string | null;
  onAutoLeave: (flight: WelcomeTitleFlight | null) => void;
  onTeardown: () => void;
};

const subscribeToNothing = () => () => {};

/** Portal/DOM-dependent overlay must only render on the client. */
const useIsClient = () =>
  useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

export const WelcomeOverlay = ({
  isVisible,
  isLeaving,
  flight,
  userName,
  userImage,
  onAutoLeave,
  onTeardown,
}: WelcomeOverlayProps) => {
  const isClient = useIsClient();
  const shouldReduceMotion = useReducedMotion();

  if (!isClient || !isVisible) {
    return null;
  }

  const activeFlight = shouldReduceMotion ? null : flight;
  const isFlying = isLeaving && activeFlight !== null;
  const words = WELCOME_TITLE_MESSAGE.split(" ");

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center overflow-hidden">
      {isLeaving ? (
        <WelcomeAnimationForcedTeardownEffect onTeardown={onTeardown} />
      ) : (
        <WelcomeAnimationAutoLeaveEffect onLeave={onAutoLeave} />
      )}

      <motion.div
        aria-hidden="true"
        className="absolute inset-0 z-0 bg-canvas will-change-[opacity]"
        initial={{ opacity: 1 }}
        animate={{ opacity: isLeaving ? 0 : 1 }}
        transition={{
          duration: shouldReduceMotion ? 0.4 : 0.7,
          delay: isLeaving ? 0.08 : 0,
          ease: [0.5, 0, 0.1, 1],
        }}
      />

      <div className="absolute inset-0 z-[1]">
        <WelcomeHalftoneCanvas isLeaving={isLeaving} />
      </div>

      <motion.div
        id={WELCOME_TITLE_SOURCE_ELEMENT_ID}
        className="relative z-[2] flex max-w-[calc(90vw)] flex-nowrap items-center justify-center gap-2 px-6 py-4 text-center text-[20px] font-semibold text-canvas-foreground will-change-transform sm:px-8 sm:text-[26px]"
        style={
          isFlying
            ? { transformOrigin: `${activeFlight.transformOriginXInPx}px center` }
            : undefined
        }
        initial={{ opacity: 0, x: 0, y: 0, scale: 1 }}
        animate={
          isFlying
            ? {
                opacity: 0,
                x: activeFlight.translateXInPx,
                y: activeFlight.translateYInPx,
                scale: activeFlight.scale,
              }
            : isLeaving
              ? { opacity: 0, x: 0, y: -10, scale: 1 }
              : { opacity: 1, x: 0, y: 0, scale: 1 }
        }
        transition={
          isFlying
            ? {
                x: { duration: 0.62, ease: [0.16, 1, 0.3, 1] },
                y: { duration: 0.62, ease: [0.16, 1, 0.3, 1] },
                scale: { duration: 0.62, ease: [0.16, 1, 0.3, 1] },
                opacity: { duration: 0.2, delay: 0.56, ease: "easeOut" },
              }
            : isLeaving
              ? { duration: 0.34, ease: [0.4, 0, 1, 1] }
              : { duration: 0.3, delay: 0.8, ease: [0.16, 1, 0.3, 1] }
        }
      >
        {words.map((word, index) => (
          <motion.span
            key={`${word}-${index}`}
            className="inline-flex"
            initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.6,
              delay: shouldReduceMotion ? 0 : 1.1 + index * 0.07,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            {word}
          </motion.span>
        ))}
        <motion.span
          className="inline-flex"
          initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.6,
            delay: shouldReduceMotion ? 0 : 1.1 + words.length * 0.07,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          <WelcomePersonChip
            name={userName}
            image={userImage}
            useBrandLogo
          />
        </motion.span>
      </motion.div>
    </div>,
    document.body,
  );
};
