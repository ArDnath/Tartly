import { WELCOME_HALFTONE_DASHES } from "@/components/onboarding/welcome-overlay/welcome-halftone-dots";
import { createWelcomeHalftoneRenderer } from "@/components/onboarding/welcome-overlay/welcome-halftone-renderer";
import type { WelcomeHalftoneController } from "@/components/onboarding/welcome-overlay/welcome-halftone-controller";

type CreateWelcomeHalftoneMainThreadControllerOptions = {
  canvas: HTMLCanvasElement;
  dotColor: string;
  prefersReducedMotion: boolean;
  initialCanvasWidth: number;
  initialCanvasHeight: number;
  devicePixelRatio: number;
};

export const createWelcomeHalftoneMainThreadController = ({
  canvas,
  dotColor,
  prefersReducedMotion,
  initialCanvasWidth,
  initialCanvasHeight,
  devicePixelRatio,
}: CreateWelcomeHalftoneMainThreadControllerOptions): WelcomeHalftoneController | null => {
  let renderingContext: CanvasRenderingContext2D | null = null;
  try {
    renderingContext = canvas.getContext("2d");
  } catch {
    renderingContext = null;
  }
  if (renderingContext === null) {
    return null;
  }

  const applyBackingStoreSize = (
    canvasWidth: number,
    canvasHeight: number,
    activeDevicePixelRatio: number,
  ) => {
    canvas.width = Math.round(canvasWidth * activeDevicePixelRatio);
    canvas.height = Math.round(canvasHeight * activeDevicePixelRatio);
  };

  applyBackingStoreSize(
    initialCanvasWidth,
    initialCanvasHeight,
    devicePixelRatio,
  );
  const renderer = createWelcomeHalftoneRenderer({
    context: renderingContext,
    dashes: WELCOME_HALFTONE_DASHES,
    width: initialCanvasWidth,
    height: initialCanvasHeight,
    devicePixelRatio,
    color: dotColor,
    reducedMotion: prefersReducedMotion,
  });

  return {
    leave: () => renderer.leave(),
    resize: (nextCanvasWidth, nextCanvasHeight, nextDevicePixelRatio) => {
      applyBackingStoreSize(
        nextCanvasWidth,
        nextCanvasHeight,
        nextDevicePixelRatio,
      );
      renderer.resize(nextCanvasWidth, nextCanvasHeight, nextDevicePixelRatio);
    },
    destroy: () => renderer.destroy(),
  };
};
