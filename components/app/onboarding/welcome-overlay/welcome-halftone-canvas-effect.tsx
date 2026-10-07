"use client";

import { useEffect, useState, type RefObject } from "react";

import { createWelcomeHalftoneMainThreadController } from "@/components/app/onboarding/welcome-overlay/create-welcome-halftone-main-thread-controller";
import { createWelcomeHalftoneWorkerController } from "@/components/app/onboarding/welcome-overlay/create-welcome-halftone-worker-controller";
import type { WelcomeHalftoneController } from "@/components/app/onboarding/welcome-overlay/welcome-halftone-controller";

type WelcomeHalftoneCanvasEffectProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  isLeaving: boolean;
  hasWorkerFailed: boolean;
  onWorkerFailed: () => void;
  /**
   * Opt-in OffscreenCanvas worker rendering. Defaults to the main thread: the
   * worker path must be explicitly enabled because transferring the canvas to
   * an offscreen context makes failures unrecoverable once control is moved.
   */
  preferWorker?: boolean;
};

export const WelcomeHalftoneCanvasEffect = ({
  canvasRef,
  isLeaving,
  hasWorkerFailed,
  onWorkerFailed,
  preferWorker = false,
}: WelcomeHalftoneCanvasEffectProps) => {
  const [activeHalftoneController, setActiveHalftoneController] =
    useState<WelcomeHalftoneController | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const prefersReducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const canvasStyles = getComputedStyle(canvas);
    const dotColor =
      canvasStyles.getPropertyValue("--welcome-dot-color").trim() || "#d4d4d8";
    const readDevicePixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);
    const readCanvasClientSize = () => ({
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    });

    const initialCanvasSize = readCanvasClientSize();
    const sharedControllerOptions = {
      canvas,
      dotColor,
      prefersReducedMotion,
      initialCanvasWidth: initialCanvasSize.width,
      initialCanvasHeight: initialCanvasSize.height,
      devicePixelRatio: readDevicePixelRatio(),
    };

    const activeController =
      (!preferWorker || hasWorkerFailed
        ? null
        : createWelcomeHalftoneWorkerController({
            ...sharedControllerOptions,
            onWorkerUnavailable: onWorkerFailed,
          })) ?? createWelcomeHalftoneMainThreadController(sharedControllerOptions);

    if (!activeController) {
      return;
    }
    setActiveHalftoneController(activeController);

    const handleWindowResize = () => {
      const nextCanvasSize = readCanvasClientSize();
      activeController.resize(
        nextCanvasSize.width,
        nextCanvasSize.height,
        readDevicePixelRatio(),
      );
    };
    window.addEventListener("resize", handleWindowResize);

    return () => {
      window.removeEventListener("resize", handleWindowResize);
      activeController.destroy();
    };
  }, [canvasRef, hasWorkerFailed, onWorkerFailed, preferWorker]);

  useEffect(() => {
    if (isLeaving) {
      activeHalftoneController?.leave();
    }
  }, [isLeaving, activeHalftoneController]);

  return null;
};
