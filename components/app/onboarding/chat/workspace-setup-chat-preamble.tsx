"use client";

import { motion } from "motion/react";

import { WelcomePersonChip } from "@/components/app/onboarding/welcome-overlay/welcome-person-chip";
import {
  WELCOME_TITLE_HANDOFF_CONTINUATION,
  WELCOME_TITLE_HANDOFF_TARGET_ELEMENT_ID,
  WELCOME_TITLE_MESSAGE,
} from "@/lib/onboarding/constants";

/**
 * The chat preamble the welcome title "flies" into. It sits at the top of the
 * setup conversation; while the overlay is up it stays invisible (but laid
 * out, so its position can be measured).
 */
export const WorkspaceSetupChatPreamble = ({
  isWelcomeVisible,
  isWelcomeLeaving,
  userName,
  userImage,
}: {
  isWelcomeVisible: boolean;
  isWelcomeLeaving: boolean;
  userName: string;
  userImage: string | null;
}) => {
  const hiddenBehindOverlay = isWelcomeVisible && !isWelcomeLeaving;
  const isRevealingAfterFlight = isWelcomeVisible && isWelcomeLeaving;

  return (
    <p className="w-full text-sm leading-relaxed text-foreground [overflow-wrap:break-word]">
      <motion.span
        id={WELCOME_TITLE_HANDOFF_TARGET_ELEMENT_ID}
        className="inline-flex items-center gap-2 whitespace-nowrap align-middle"
        initial={false}
        animate={{ opacity: hiddenBehindOverlay ? 0 : 1 }}
        transition={
          isRevealingAfterFlight
            ? { duration: 0.12, delay: 0.62, ease: "easeOut" }
            : { duration: 0.12 }
        }
      >
        {WELCOME_TITLE_MESSAGE}
        <WelcomePersonChip
          name={userName}
          image={userImage}
          useBrandLogo
          size="sm"
        />
      </motion.span>{" "}
      <motion.span
        initial={false}
        animate={{ opacity: hiddenBehindOverlay ? 0 : 1 }}
        transition={
          isRevealingAfterFlight
            ? { duration: 0.2, delay: 0.8, ease: "easeOut" }
            : { duration: 0.2 }
        }
      >
        {WELCOME_TITLE_HANDOFF_CONTINUATION}
      </motion.span>
    </p>
  );
};
