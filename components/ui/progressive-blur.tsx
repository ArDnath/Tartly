import { cn } from "@/lib/utils"

type ProgressiveBlurDirection = "to bottom" | "to top"

/**
 * `"both"` layers an upward and a downward ramp on top of each other. Each ramp
 * is sharp at one edge and strongest at the other, so combined the blur stays
 * near-uniform across the middle instead of fading in one direction — which
 * reads as a solid frosted panel rather than a blur bleeding outward.
 *
 * `"outward"` blurs the element's own footprint at full strength and feathers
 * to zero in every direction, so the frost hugs the element and dissolves into
 * the sharp background as it moves away from it.
 */
type ProgressiveBlurMode = ProgressiveBlurDirection | "both" | "outward"

interface ProgressiveBlurProps {
  className?: string
  /** Edge the blur grows toward. `to bottom` keeps the top sharp. */
  direction?: ProgressiveBlurMode
  /** Number of stacked blur layers per ramp — more layers, smoother ramp. */
  layers?: number
  /** Blur in px reached at the most-blurred edge. */
  maxBlur?: number
  /** Fraction of the region held fully sharp at the sharp edge (0–1). */
  sharpUntil?: number
  /**
   * Outward mode only: how far the blur reaches past the element before it
   * fades to zero, as a CSS length (e.g. `"5rem"`). The element is assumed to
   * fill the parent box, so this is the negative inset the frost occupies on
   * every side.
   */
  spread?: string
  /**
   * Outward mode only: shape of the falloff. `"rect"` keeps the element's
   * rectangular footprint and feathers its edges; `"ellipse"` shapes the frost
   * as a soft glow that peaks behind the element and rounds away on every side.
   */
  shape?: "rect" | "ellipse"
  /**
   * Outward ellipse only: fraction of the radius that stays fully blurred
   * before the fade to zero begins (0–1). Lower values start the fade sooner
   * and stretch it further out, so the frost trails off instead of ending on a
   * visible edge. Defaults to `0.8`.
   */
  fadeStart?: number
}

const clamp = (value: number) => Math.min(100, Math.max(0, value))

interface BlurStackProps {
  direction: ProgressiveBlurDirection
  count: number
  band: number
  feather: number
  sharpUntil: number
  maxBlur: number
}

function BlurStack({
  direction,
  count,
  band,
  feather,
  sharpUntil,
  maxBlur,
}: BlurStackProps) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => {
        // `start`/`end` are measured from the sharp edge, which lines up with
        // the 0% stop of the gradient when `direction` is used as the gradient
        // angle (`to bottom` = top, `to top` = bottom).
        const start = sharpUntil + band * index
        const end = start + band
        const blur = (maxBlur * (index + 1)) / count

        const mask = `linear-gradient(${direction}, transparent ${clamp(
          (start - feather) * 100,
        )}%, black ${clamp(start * 100)}%, black ${clamp(
          end * 100,
        )}%, transparent ${clamp((end + feather) * 100)}%)`

        return (
          <div
            key={index}
            className="absolute inset-0"
            style={{
              backdropFilter: `blur(${blur}px)`,
              WebkitBackdropFilter: `blur(${blur}px)`,
              maskImage: mask,
              WebkitMaskImage: mask,
            }}
          />
        )
      })}
    </>
  )
}

/**
 * Progressive (graduated) blur.
 *
 * Renders a `backdrop-filter` layer (or a stack of them) masked so the blur
 * strength ramps across the surface rather than switching on at a hard edge.
 * Whatever sits *behind* this component — a background image, for instance —
 * stays sharp where the mask is transparent and blurs where the mask is
 * opaque.
 *
 * `direction="outward"` blurs the element's footprint in full and feathers the
 * mask to zero on all four sides, so the frost is strongest against the
 * element and disappears as it moves away from it. The directional modes
 * (`to bottom`, `to top`, `both`) instead ramp along a single axis, useful when
 * blending a section into the page.
 *
 * The component is inert (`pointer-events-none absolute`) and meant to be
 * placed directly behind the element it should blur.
 */
export function ProgressiveBlur({
  className,
  direction = "to bottom",
  layers = 8,
  maxBlur = 24,
  sharpUntil = 0.12,
  spread = "4rem",
  shape = "rect",
  fadeStart = 0.8,
}: ProgressiveBlurProps) {
  if (direction === "outward") {
    const isEllipse = shape === "ellipse"
    const core = Math.min(1, Math.max(0, fadeStart)) * 100

    // Rect: fully opaque across the element, fading to transparent `spread`
    // away from each edge. Intersecting a horizontal and a vertical ramp
    // yields the rectangular feather; `min(h, v)` fades the corners too.
    // Ellipse: a soft oval glow that peaks behind the element and rounds away
    // on every side, so the falloff never reads as a hard rectangle.
    const mask = isEllipse
      ? `radial-gradient(ellipse at center, black 0%, black ${core}%, transparent 100%)`
      : `linear-gradient(to right, transparent 0, black ${spread}, black calc(100% - ${spread}), transparent 100%), linear-gradient(to bottom, transparent 0, black ${spread}, black calc(100% - ${spread}), transparent 100%)`

    return (
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute overflow-hidden",
          className,
        )}
        style={{
          inset: `calc(-1 * ${spread})`,
          backdropFilter: `blur(${maxBlur}px)`,
          WebkitBackdropFilter: `blur(${maxBlur}px)`,
          maskImage: mask,
          WebkitMaskImage: mask,
          ...(isEllipse
            ? {}
            : {
                maskComposite: "intersect" as const,
                WebkitMaskComposite: "source-in",
              }),
        }}
      />
    )
  }

  const count = Math.max(1, Math.round(layers))
  const span = 1 - sharpUntil
  const band = span / count
  // Overlap neighbouring bands so the ramp reads as continuous.
  const feather = band * 0.8

  const directions: ProgressiveBlurDirection[] =
    direction === "both" ? ["to bottom", "to top"] : [direction]

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
    >
      {directions.map((dir) => (
        <BlurStack
          key={dir}
          direction={dir}
          count={count}
          band={band}
          feather={feather}
          sharpUntil={sharpUntil}
          maxBlur={maxBlur}
        />
      ))}
    </div>
  )
}

