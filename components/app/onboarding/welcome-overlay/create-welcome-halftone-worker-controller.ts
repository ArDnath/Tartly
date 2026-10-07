"use client";

import type { WelcomeHalftoneController } from "@/components/app/onboarding/welcome-overlay/welcome-halftone-controller";

const WORKER_FIRST_FRAME_TIMEOUT_MS = 1000;

type CreateWelcomeHalftoneWorkerControllerOptions = {
  canvas: HTMLCanvasElement;
  dotColor: string;
  prefersReducedMotion: boolean;
  initialCanvasWidth: number;
  initialCanvasHeight: number;
  devicePixelRatio: number;
  onWorkerUnavailable: () => void;
};

/**
 * Offloads the halftone animation to a Web Worker via OffscreenCanvas. Returns
 * `null` when the browser cannot support it, letting the caller fall back to
 * the main-thread controller.
 */
export const createWelcomeHalftoneWorkerController = ({
  canvas,
  dotColor,
  prefersReducedMotion,
  initialCanvasWidth,
  initialCanvasHeight,
  devicePixelRatio,
  onWorkerUnavailable,
}: CreateWelcomeHalftoneWorkerControllerOptions): WelcomeHalftoneController | null => {
  const isOffscreenCanvasSupported =
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof canvas.transferControlToOffscreen === "function";

  if (!isOffscreenCanvasSupported) {
    return null;
  }

  let worker: Worker | null = null;
  let workerReadyTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let hasWorkerSettled = false;
  let hasCanvasBeenTransferred = false;

  const settleWorker = () => {
    hasWorkerSettled = true;
    if (workerReadyTimeoutId !== null) {
      clearTimeout(workerReadyTimeoutId);
      workerReadyTimeoutId = null;
    }
  };

  const handleWorkerUnavailable = () => {
    if (hasWorkerSettled) {
      return;
    }
    settleWorker();
    worker?.terminate();
    onWorkerUnavailable();
  };

  try {
    worker = new Worker(
      new URL("./welcome-halftone.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerReadyTimeoutId = setTimeout(
      handleWorkerUnavailable,
      WORKER_FIRST_FRAME_TIMEOUT_MS,
    );
    worker.onerror = handleWorkerUnavailable;
    worker.onmessage = (event: MessageEvent<{ type?: string }>) => {
      // Settle only once a frame has actually been painted. A worker that
      // loads but never draws (e.g. throttled rAF) would otherwise leave a
      // permanently blank canvas, since control has already been transferred.
      if (event.data?.type === "first-frame") {
        settleWorker();
      }
    };

    const offscreenCanvas = canvas.transferControlToOffscreen();
    hasCanvasBeenTransferred = true;
    worker.postMessage(
      {
        type: "init",
        canvas: offscreenCanvas,
        width: initialCanvasWidth,
        height: initialCanvasHeight,
        devicePixelRatio,
        color: dotColor,
        reducedMotion: prefersReducedMotion,
      },
      [offscreenCanvas],
    );

    return {
      leave: () => worker?.postMessage({ type: "leave" }),
      resize: (nextCanvasWidth, nextCanvasHeight, nextDevicePixelRatio) =>
        worker?.postMessage({
          type: "resize",
          width: nextCanvasWidth,
          height: nextCanvasHeight,
          devicePixelRatio: nextDevicePixelRatio,
        }),
      destroy: () => {
        settleWorker();
        worker?.postMessage({ type: "stop" });
        worker?.terminate();
      },
    };
  } catch {
    settleWorker();
    worker?.terminate();
    if (hasCanvasBeenTransferred) {
      onWorkerUnavailable();
    }
    return null;
  }
};
