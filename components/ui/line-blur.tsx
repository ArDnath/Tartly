"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

import { ProgressiveBlur } from "@/components/ui/progressive-blur"
import { cn } from "@/lib/utils"

interface LineRect {
  top: number
  left: number
  width: number
  height: number
}

interface LineBlurProps {
  children: ReactNode
  className?: string
  /** Blur strength reached at the centre of every line. */
  maxBlur?: number
  /** How far a line's blur feathers past the text before it hits zero. */
  spread?: string
  /** `rect` keeps a soft band per line; `ellipse` rounds each into a glow. */
  shape?: "rect" | "ellipse"
  /**
   * `ellipse` only: where the fade to zero begins, as a fraction of each
   * line's blur radius (0–1). Lower = longer, softer trail-off.
   */
  fade?: number
}

const EPSILON = 0.5

function sameLines(a: LineRect[], b: LineRect[]) {
  if (a.length !== b.length) return false
  return a.every((line, index) => {
    const other = b[index]
    return (
      other !== undefined &&
      Math.abs(line.top - other.top) < EPSILON &&
      Math.abs(line.left - other.left) < EPSILON &&
      Math.abs(line.width - other.width) < EPSILON &&
      Math.abs(line.height - other.height) < EPSILON
    )
  })
}

/**
 * Wraps flowing text and paints an outward-fading progressive blur behind each
 * rendered line independently — a frosted band that dissolves to nothing on
 * every side rather than one rectangle behind the whole block.
 *
 * Line boxes come from a DOM `Range`, which reports one rect per visual line no
 * matter how the text wraps. They are re-read on resize and after webfonts
 * load, and every frame for the first couple of seconds so the bands track text
 * that is still animating into place.
 */
export function LineBlur({
  children,
  className,
  maxBlur = 44,
  spread = "1rem",
  shape = "ellipse",
  fade = 0.35,
}: LineBlurProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<LineRect[]>([])

  useEffect(() => {
    const root = rootRef.current
    const text = textRef.current
    if (!root || !text) return

    let frame = 0
    let lastKey = ""
    let stable = 0
    const startedAt = performance.now()

    const measure = () => {
      const rootRect = root.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(text)

      const rects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > EPSILON && rect.height > EPSILON,
      )

      const next: LineRect[] = []
      for (const rect of rects) {
        const top = rect.top - rootRect.top
        const left = rect.left - rootRect.left
        // One visual line can surface as several rects when it contains inline
        // children; merge anything sharing a baseline into a single band.
        const line = next.find(
          (candidate) => Math.abs(candidate.top - top) < candidate.height / 2,
        )
        if (line) {
          const right = Math.max(line.left + line.width, left + rect.width)
          line.left = Math.min(line.left, left)
          line.width = right - line.left
          line.height = Math.max(line.height, rect.height)
        } else {
          next.push({ top, left, width: rect.width, height: rect.height })
        }
      }

      const key = JSON.stringify(next)
      if (key === lastKey) stable += 1
      else {
        lastKey = key
        stable = 0
      }

      setLines((current) => (sameLines(current, next) ? current : next))
    }

    const follow = () => {
      measure()
      // Ride the entry animation, then hand off to the observers below.
      if (stable < 3 && performance.now() - startedAt < 2500) {
        frame = requestAnimationFrame(follow)
      }
    }
    frame = requestAnimationFrame(follow)

    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(text)
    window.addEventListener("resize", measure)
    document.fonts?.ready.then(measure).catch(() => {})

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [])

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
        {lines.map((line, index) => (
          <div
            key={index}
            className="absolute"
            style={{
              top: line.top,
              left: line.left,
              width: line.width,
              height: line.height,
            }}
          >
            <ProgressiveBlur
              direction="outward"
              shape={shape}
              maxBlur={maxBlur}
              spread={spread}
              fadeStart={fade}
            />
          </div>
        ))}
      </div>
      <div ref={textRef} className="relative z-10">
        {children}
      </div>
    </div>
  )
}
