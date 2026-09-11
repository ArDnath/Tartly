"use client";

import { useEffect, useRef } from "react";

const FORCED_TEARDOWN_DELAY_IN_MS = 1100;

/** Removes the overlay once its leaving animation has finished. */
export const WelcomeAnimationForcedTeardownEffect = ({
  onTeardown,
}: {
  onTeardown: () => void;
}) => {
  const onTeardownRef = useRef(onTeardown);

  useEffect(() => {
    onTeardownRef.current = onTeardown;
  }, [onTeardown]);

  useEffect(() => {
    const timeoutId = setTimeout(
      () => onTeardownRef.current(),
      FORCED_TEARDOWN_DELAY_IN_MS,
    );

    return () => clearTimeout(timeoutId);
  }, []);

  return null;
};
