'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Moon, Sun } from '@phosphor-icons/react';
import { flushSync } from 'react-dom';

import {
  applyTheme,
  getCurrentTheme,
  playThemeClick,
  type Theme,
} from '@/lib/theme';
import { cn } from '@/lib/utils';

/**
 * The landing's light/dark switch.
 *
 * The nav needed a literal switch rather than the app sidebar's single-icon
 * button, so this is a compact track-and-thumb control: sun while dark, moon
 * while light, with the thumb sliding across the track. It drives the same
 * app-wide theme as `AnimatedThemeToggler` (the `dark` class on `<html>`, see
 * lib/theme.ts) and adds the same two touches:
 *
 * - a circular view-transition reveal radiating from the switch (skipped under
 *   `prefers-reduced-motion` or where `startViewTransition` is absent),
 * - the software click, voiced per direction (lib/theme.ts).
 *
 * State is read straight off the `<html>` class through a MutationObserver, so
 * the thumb stays correct no matter who flipped the theme — this switch, the
 * boot script, another tab, or the app sidebar.
 */
export function ThemeSwitch({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>('dark');
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const syncFromDom = () => setTheme(getCurrentTheme());
    syncFromDom();

    const observer = new MutationObserver(syncFromDom);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);

  const toggleTheme = useCallback(async () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    playThemeClick(next);

    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    if (
      reduceMotion ||
      typeof document.startViewTransition !== 'function' ||
      !buttonRef.current
    ) {
      applyTheme(next);
      return;
    }

    await document.startViewTransition(() => {
      flushSync(() => applyTheme(next));
    }).ready;

    const { top, left, width, height } =
      buttonRef.current.getBoundingClientRect();
    const x = left + width / 2;
    const y = top + height / 2;
    const maxRadius = Math.hypot(
      Math.max(left, window.innerWidth - left),
      Math.max(top, window.innerHeight - top),
    );

    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${maxRadius}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration: 400,
        easing: 'ease-in-out',
        pseudoElement: '::view-transition-new(root)',
      },
    );
  }, [theme]);

  const isLight = theme === 'light';

  return (
    <button
      ref={buttonRef}
      type="button"
      role="switch"
      aria-checked={isLight}
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      onClick={toggleTheme}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border border-border bg-muted p-0.5 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-6 items-center justify-center rounded-full bg-background text-foreground shadow-sm transition-transform duration-300 ease-out',
          isLight && 'translate-x-5',
        )}
      >
        {isLight ? (
          <Sun className="size-3.5" weight="bold" />
        ) : (
          <Moon className="size-3.5" weight="bold" />
        )}
      </span>
    </button>
  );
}
