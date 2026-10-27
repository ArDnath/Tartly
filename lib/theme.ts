/**
 * App-wide light/dark theme helpers.
 *
 * The theme is the `dark` class on `<html>`: `app/globals.css` defines the
 * light palette on `:root` and the dark palette on `.dark`, so every token-
 * based surface flips with the class. A user's explicit choice is persisted
 * in localStorage; with no stored choice the OS preference wins, falling back
 * to the brand-default dark.
 *
 * The landing (`/`) follows this switch: its page chrome reads the
 * `--landing-*` tokens (globals.css), which resolve to the light or dark
 * palette per the `dark` class — pricing table included. Its product
 * mock-ups, trust panel and footer stay deliberately dark in both themes.
 * `/pricing` is still pinned dark via a `dark` wrapper class and omits the
 * switch.
 */

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

const DEFAULT_THEME: Theme = "dark";

/** The user's stored choice, or null when they have never picked one. */
export function getStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

/** Effective theme: explicit choice → OS preference → brand default. */
export function resolveTheme(): Theme {
  const stored = getStoredTheme();
  if (stored) return stored;
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
  ) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return DEFAULT_THEME;
}

export function getCurrentTheme(): Theme {
  if (typeof document === "undefined") return DEFAULT_THEME;
  return document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
}

/**
 * Flip the `<html>` class (and persist the choice unless told otherwise).
 * Observers of the class attribute (theme toggler, persona orb, ECharts)
 * pick the change up from here — this is the single writer.
 */
export function applyTheme(theme: Theme, { persist = true } = {}): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  if (!persist) return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private-mode storage failures must not break the toggle.
  }
}

/*
 * Toggle click — a tiny synthesized mechanical "tick", so no audio asset is
 * shipped. The two directions are voiced differently: brightening (→ light)
 * starts higher and lands higher; dimming (→ dark) is a duller, lower thock.
 * Audio is a nicety: every failure path is swallowed.
 */
let sharedAudioContext: AudioContext | null = null;

export function playThemeClick(target: Theme): void {
  if (typeof window === "undefined") return;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return;

  try {
    sharedAudioContext ??= new Ctor();
    const ctx = sharedAudioContext;
    if (ctx.state === "suspended") void ctx.resume();

    const now = ctx.currentTime;
    const [startFreq, endFreq] =
      target === "light" ? [1500, 950] : [760, 380];

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.07);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  } catch {
    // Never let sound break theming.
  }
}
