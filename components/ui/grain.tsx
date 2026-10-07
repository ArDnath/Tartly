"use client";

import { useMemo, useSyncExternalStore } from "react";

interface GrainProps {
  opacity?: number;
}

const TILE_SIZE = 128;

function generateNoiseDataUrl(): string {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const imageData = ctx.createImageData(TILE_SIZE, TILE_SIZE);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const v = Math.random() * 255;
    imageData.data[i] = v;
    imageData.data[i + 1] = v;
    imageData.data[i + 2] = v;
    imageData.data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL();
}

const emptySubscribe = () => () => {};

/**
 * Full-viewport film-grain overlay.
 *
 * Ported from portfolio-neo's `components/shared/grain.tsx` so the Tartly
 * landing shares the same grainy texture as the portfolio's dark base. The
 * noise tile is generated once on the client and repeated across the screen;
 * the layer is inert (`pointer-events-none`) and sits above the page.
 *
 * `useSyncExternalStore` is used purely as an SSR-safe "is this the client?"
 * check, so the canvas work never runs on the server and no state is set from
 * an effect.
 */
export function Grain({ opacity = 0.05 }: GrainProps) {
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const dataUrl = useMemo(
    () => (mounted ? generateNoiseDataUrl() : ""),
    [mounted],
  );

  if (!mounted || !dataUrl) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[100]"
      aria-hidden="true"
      style={{
        opacity,
        backgroundImage: `url(${dataUrl})`,
        backgroundRepeat: "repeat",
        backgroundSize: `${TILE_SIZE}px ${TILE_SIZE}px`,
      }}
    />
  );
}
