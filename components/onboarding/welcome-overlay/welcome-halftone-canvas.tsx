"use client";

import { useCallback, useRef, useState } from "react";

import { WelcomeHalftoneCanvasEffect } from "@/components/onboarding/welcome-overlay/welcome-halftone-canvas-effect";

type WelcomeHalftoneCanvasProps = {
  isLeaving: boolean;
};

export const WelcomeHalftoneCanvas = ({
  isLeaving,
}: WelcomeHalftoneCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasWorkerFailed, setHasWorkerFailed] = useState(false);
  const markWorkerAsFailed = useCallback(() => setHasWorkerFailed(true), []);

  return (
    <>
      <canvas
        key={hasWorkerFailed ? "main-thread" : "worker"}
        ref={canvasRef}
        aria-hidden="true"
        className="block size-full [--welcome-dot-color:#d4d4d8]"
      />
      <WelcomeHalftoneCanvasEffect
        canvasRef={canvasRef}
        isLeaving={isLeaving}
        hasWorkerFailed={hasWorkerFailed}
        onWorkerFailed={markWorkerAsFailed}
      />
    </>
  );
};
