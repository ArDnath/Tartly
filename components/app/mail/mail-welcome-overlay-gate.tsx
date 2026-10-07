"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";

/**
 * The welcome overlay carries the halftone animation data and canvas/worker
 * controllers — close to 100 KB that only matters on the one navigation where
 * onboarding hands off with `?welcome=1`.
 *
 * This gate checks the flag first and only then pulls the overlay chunk, so an
 * ordinary `/mail` visit never pays for it. `ssr: false` is safe: the overlay
 * is a client-only portal that already renders nothing until mounted.
 */
const MailWelcomeOverlay = dynamic(
  () =>
    import("@/components/app/mail/mail-welcome-overlay").then(
      (module) => module.MailWelcomeOverlay,
    ),
  { ssr: false },
);

/**
 * The cover painted before the animation chunk arrives.
 *
 * The overlay is a separate chunk, so on the onboarding handoff the live mail
 * route would otherwise be visible for the frames it takes to fetch and mount
 * it. This cover is part of the gate's own (tiny) render, so it paints in the
 * same commit as `/mail` — the route is masked from the very first frame — and
 * it matches the overlay's canvas background so the handoff reads as one
 * surface. The gate drops it once the overlay has mounted and painted over it.
 */
function WelcomeOverlayCover() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[99] bg-canvas"
    />
  );
}

function WelcomeGateInner() {
  const searchParams = useSearchParams();

  /**
   * Latch the flag on first render instead of reading it live. The overlay
   * consumes `?welcome=1` by rewriting the URL with `history.replaceState`, and
   * Next.js mirrors that external change back into `useSearchParams`. Reading
   * the live value here would unmount the overlay the instant it starts, which
   * is exactly what killed the halftone animation. Once the flag is seen, the
   * gate keeps the overlay mounted; the overlay owns its own teardown.
   */
  const [shouldShowWelcome] = useState(
    () => searchParams.get("welcome") === "1",
  );

  // The overlay paints its own opaque canvas once mounted, so its cover can
  // come down then. It must not outlive the overlay, or the now-finished app
  // would stay hidden behind it.
  const [overlayMounted, setOverlayMounted] = useState(false);
  const handleOverlayMounted = useCallback(() => setOverlayMounted(true), []);

  if (!shouldShowWelcome) return null;
  return (
    <>
      {overlayMounted ? null : <WelcomeOverlayCover />}
      <MailWelcomeOverlay onMounted={handleOverlayMounted} />
    </>
  );
}

export function MailWelcomeOverlayGate() {
  return (
    <Suspense fallback={null}>
      <WelcomeGateInner />
    </Suspense>
  );
}
