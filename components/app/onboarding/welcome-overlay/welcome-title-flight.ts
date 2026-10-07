import {
  WELCOME_TITLE_HANDOFF_TARGET_ELEMENT_ID,
  WELCOME_TITLE_SOURCE_ELEMENT_ID,
} from "@/lib/onboarding/constants";
import type { WelcomeTitleFlight } from "@/lib/onboarding/types";

export function getWelcomeTitleFlight({
  sourceRect,
  sourcePaddingLeftInPx,
  sourceFontSizeInPx,
  targetRect,
  targetFontSizeInPx,
}: {
  sourceRect: DOMRect;
  sourcePaddingLeftInPx: number;
  sourceFontSizeInPx: number;
  targetRect: DOMRect;
  targetFontSizeInPx: number;
}): WelcomeTitleFlight {
  const sourceTextLeft = sourceRect.left + sourcePaddingLeftInPx;
  const sourceCenterY = sourceRect.top + sourceRect.height / 2;
  const targetCenterY = targetRect.top + targetRect.height / 2;

  return {
    translateXInPx: targetRect.left - sourceTextLeft,
    translateYInPx: targetCenterY - sourceCenterY,
    scale: sourceFontSizeInPx > 0 ? targetFontSizeInPx / sourceFontSizeInPx : 1,
    transformOriginXInPx: sourcePaddingLeftInPx,
  };
}

const isElementLaidOutAndVisible = (
  rect: DOMRect,
  style: CSSStyleDeclaration,
) => rect.width > 0 && rect.height > 0 && style.visibility === "visible";

/**
 * Measures the overlay title (source) against the chat preamble handoff run
 * (target) so the overlay title can be animated to land exactly on it.
 */
export function measureWelcomeTitleFlight(): WelcomeTitleFlight | null {
  const sourceElement = document.getElementById(
    WELCOME_TITLE_SOURCE_ELEMENT_ID,
  );
  const targetElement = document.getElementById(
    WELCOME_TITLE_HANDOFF_TARGET_ELEMENT_ID,
  );

  if (!sourceElement || !targetElement) {
    return null;
  }

  const sourceStyle = window.getComputedStyle(sourceElement);
  const targetStyle = window.getComputedStyle(targetElement);
  const sourceRect = sourceElement.getBoundingClientRect();
  const targetRect = targetElement.getBoundingClientRect();

  if (
    !isElementLaidOutAndVisible(sourceRect, sourceStyle) ||
    !isElementLaidOutAndVisible(targetRect, targetStyle)
  ) {
    return null;
  }

  return getWelcomeTitleFlight({
    sourceRect,
    sourcePaddingLeftInPx: parseFloat(sourceStyle.paddingLeft) || 0,
    sourceFontSizeInPx: parseFloat(sourceStyle.fontSize) || 0,
    targetRect,
    targetFontSizeInPx: parseFloat(targetStyle.fontSize) || 0,
  });
}
