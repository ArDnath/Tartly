"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Moon, Sun } from "@phosphor-icons/react"
import { flushSync } from "react-dom"

import {
  applyTheme,
  getCurrentTheme,
  playThemeClick,
  type Theme,
} from "@/lib/theme"
import { cn } from "@/lib/utils"

interface AnimatedThemeTogglerProps
  extends React.ComponentPropsWithoutRef<"button"> {
  duration?: number
}

/**
 * App-wide light/dark toggle. The switch is the `dark` class on `<html>` (see
 * lib/theme.ts); on top of the plain flip this adds:
 *
 * - a circular view-transition reveal radiating from the button (skipped
 *   under `prefers-reduced-motion` or where `startViewTransition` is absent),
 * - a soft synthesized click, voiced per direction (lib/theme.ts).
 *
 * State is read straight off the `<html>` class through a MutationObserver,
 * so the icon stays correct no matter who flipped the theme (this button, the
 * boot script, or another tab via the root layout's <ThemeSync>).
 */
export const AnimatedThemeToggler = ({
  className,
  duration = 400,
  ...props
}: AnimatedThemeTogglerProps) => {
  const [theme, setTheme] = useState<Theme>("dark")
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const syncFromDom = () => setTheme(getCurrentTheme())
    syncFromDom()

    const observer = new MutationObserver(syncFromDom)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })

    return () => observer.disconnect()
  }, [])

  const toggleTheme = useCallback(async () => {
    const next: Theme = theme === "dark" ? "light" : "dark"
    playThemeClick(next)

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches

    if (
      reduceMotion ||
      typeof document.startViewTransition !== "function" ||
      !buttonRef.current
    ) {
      applyTheme(next)
      return
    }

    await document.startViewTransition(() => {
      flushSync(() => applyTheme(next))
    }).ready

    const { top, left, width, height } =
      buttonRef.current.getBoundingClientRect()
    const x = left + width / 2
    const y = top + height / 2
    const maxRadius = Math.hypot(
      Math.max(left, window.innerWidth - left),
      Math.max(top, window.innerHeight - top)
    )

    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${maxRadius}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration,
        easing: "ease-in-out",
        pseudoElement: "::view-transition-new(root)",
      }
    )
  }, [theme, duration])

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={toggleTheme}
      aria-label={
        theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
      }
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(className)}
      {...props}
    >
      {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
      <span className="sr-only">Toggle theme</span>
    </button>
  )
}
