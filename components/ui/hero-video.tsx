"use client"

import { useEffect, useRef } from "react"

import { buildSrc } from "@imagekit/next"

import { MediaImage } from "@/components/shared/media"
import {
  getImageKitUrlEndpoint,
  isImageKitConfigured,
} from "@/lib/imagekit/config"
import { cn } from "@/lib/utils"

interface HeroVideoProps {
  /**
   * iframe embed (YouTube, Vimeo, …) or a direct video file (`.mp4`, `.webm`,
   * …). Direct files play inline; embeds autoplay muted and loop.
   * Used when no ImageKit video path is configured.
   */
  videoSrc?: string
  /** ImageKit media-library path for the video, e.g. `/tartly-demo.mp4`. */
  videoPath?: string
  /** ImageKit media-library path for the thumbnail; falls back to `thumbnailSrc`. */
  thumbnailPath?: string
  /** Plain `<img>` thumbnail used while ImageKit is unconfigured. */
  thumbnailSrc: string
  thumbnailAlt?: string
  className?: string
}

const DIRECT_VIDEO_RE = /\.(mp4|m4v|webm|ogv|ogg|mov)(\?.*)?$/i

/**
 * Play the demo a touch slower than 1× so the UI motion in the loop reads as
 * deliberate instead of frantic.
 */
const HERO_PLAYBACK_RATE = 0.85

/**
 * The video is presented in a standard widescreen (16:9) window. The cell
 * around this component is taller than that window, so the media sits centered
 * with dark bars above and below — a movie playing inside the frame.
 */
const VIDEO_ASPECT = "16 / 9"

function isDirectVideo(src: string): boolean {
  return DIRECT_VIDEO_RE.test(src.trim())
}

/** Force autoplay/mute/loop on a YouTube/Vimeo embed URL. */
function withAutoplayParams(src: string): string {
  try {
    const url = new URL(src)
    url.searchParams.set("autoplay", "1")
    url.searchParams.set("mute", "1")
    url.searchParams.set("loop", "1")
    url.searchParams.set("playsinline", "1")
    url.searchParams.set("controls", "0")
    url.searchParams.set("modestbranding", "1")
    url.searchParams.set("rel", "0")
    // YouTube only honors `loop` for a single video when `playlist` repeats it.
    if (/(^|\.)youtu\.?be(\.com)?$/.test(url.hostname)) {
      const id = url.pathname.split("/").filter(Boolean).pop()
      if (id) url.searchParams.set("playlist", id)
    }
    return url.toString()
  } catch {
    return src
  }
}

/**
 * The landing hero video.
 *
 * Plays immediately, muted and looping (slightly under 1×), with no hover or
 * scroll choreography. A thick, glassmorphic frame wraps the media; only the
 * left corners are rounded so the frame reads flush against the right edge of
 * the viewport, and the frame is bordered on the left, top and bottom only.
 * The media itself plays in a 16:9 widescreen window centered in the frame.
 */
export function HeroVideo({
  videoSrc,
  videoPath,
  thumbnailPath,
  thumbnailSrc,
  thumbnailAlt = "Video thumbnail",
  className,
}: HeroVideoProps) {
  // Prefer an ImageKit-hosted video once an endpoint and a path are set.
  const useImageKitVideo =
    isImageKitConfigured() && Boolean(videoPath?.trim())

  // Resolve an inline-playable URL: ImageKit path first, then a direct file.
  const inlineVideoUrl = useImageKitVideo
    ? buildSrc({
        urlEndpoint: getImageKitUrlEndpoint(),
        src: (videoPath ?? "").trim(),
        // Keep the loop crisp but light: cap the width, re-encode at a
        // reasonable quality, and let ImageKit serve the most efficient
        // codec/container the browser supports.
        transformation: [{ width: 1440, quality: 80, format: "auto" }],
      })
    : videoSrc && isDirectVideo(videoSrc)
      ? videoSrc
      : undefined

  const hasInlineVideo = Boolean(inlineVideoUrl)

  // An embed (YouTube/Vimeo) can't be driven by a native <video>, so it is
  // forced to autoplay muted and loop.
  const embedUrl =
    !hasInlineVideo && videoSrc && !isDirectVideo(videoSrc)
      ? withAutoplayParams(videoSrc)
      : undefined

  const videoRef = useRef<HTMLVideoElement>(null)

  // `playbackRate` is not a declarative attribute, so set it once the element
  // exists. Re-applied on metadata load because some browsers reset the rate
  // when a new source is attached.
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = HERO_PLAYBACK_RATE
  }, [inlineVideoUrl])

  return (
    // Thick glassmorphic frame: a translucent, blurred pane with a light
    // gradient edge. Rounded on the left only so it sits flush against the
    // right edge of the viewport — and bordered on the left, top and bottom
    // only, since the right edge bleeds off-screen.
    <div
      className={cn(
        "relative h-full w-full rounded-l-[2rem] border-y border-l border-white/20 p-2 pr-0",
        "bg-gradient-to-br from-white/25 via-white/10 to-white/[0.04] backdrop-blur-xl",
        "shadow-[0_30px_90px_-30px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-1px_0_rgba(255,255,255,0.08)]",
        className,
      )}
    >
      {/* Screen. The media lives in a 16:9 window centered in the frame; the
          leftover height above and below reads as cinematic letterboxing. */}
      <div className="relative flex h-full w-full items-center overflow-hidden rounded-l-[calc(2rem-0.5rem)] bg-black/70">
        <div
          className="relative h-full w-full overflow-hidden bg-black lg:h-auto"
          style={{ aspectRatio: VIDEO_ASPECT }}
        >
          <MediaImage
            src={thumbnailPath ?? ""}
            fallbackSrc={thumbnailSrc}
            alt={thumbnailAlt}
            width={1920}
            height={1080}
            loading="eager"
            className="absolute inset-0 h-full w-full object-cover"
          />

          {/* Inline video — always playing, muted and looping, slowed down. */}
          {hasInlineVideo ? (
            <video
              ref={videoRef}
              src={inlineVideoUrl}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              onLoadedMetadata={(event) => {
                event.currentTarget.playbackRate = HERO_PLAYBACK_RATE
              }}
              className="absolute inset-0 size-full object-cover"
            />
          ) : embedUrl ? (
            <iframe
              src={embedUrl}
              title="Hero video player"
              className="pointer-events-none absolute inset-0 size-full"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
