---
name: Tartly
description: A dark, Gmail-native AI email operator — an operator's desk for the inbox.
theming:
  summary: >
    Dual-theme token system (light + dark). `:root` in app/globals.css holds the
    light palette, `.dark` the brand dark palette; the toggle flips the `dark`
    class on `<html>` (lib/theme.ts + boot script in app/layout.tsx, persisted
    to localStorage, OS preference as default). The landing (`/`) follows the
    switch through `--landing-*` chrome tokens; its product mock-ups, trust
    panel and footer stay deliberately dark. `/pricing` is exempt: it pins a
    `dark` wrapper class because its panel is designed for the dark canvas.
colors:
  canvas: "#1b1b1b"
  canvas-foreground: "#f4f4f5"
  card: "#222222"
  muted: "#262626"
  accent: "#2e2e2e"
  muted-foreground: "#a1a1aa"
  border: "rgba(255, 255, 255, 0.08)"
  input: "rgba(255, 255, 255, 0.12)"
  activity-accent: "#f2b4cb"
  activity-accent-soft: "#f7d2e0"
  activity-accent-ink: "#2b1622"
  warning: "#f8b84e"
  mail-unread: "#8ab4f8"
  mail-draft: "#f28b82"
  ai-spectrum-orange: "#ff5e00"
  ai-spectrum-purple: "#8a43e1"
  ai-spectrum-blue: "#1800e7"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(2.25rem, 6vw, 3.75rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.5rem, 3vw, 1.875rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.12em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.canvas-foreground}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "rgba(244, 244, 245, 0.8)"
    textColor: "{colors.canvas}"
    rounded: "{rounded.md}"
  button-outline:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.canvas-foreground}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.canvas-foreground}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
    height: "36px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.canvas-foreground}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
    height: "36px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.canvas-foreground}"
    rounded: "{rounded.xl}"
    padding: "24px"
  tag-chip:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.canvas-foreground}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
---

# Design System: Tartly

## Overview

**Creative North Star: "The Operator's Desk"**

Tartly is a dark, quiet workstation. The room is one near-black canvas
(`#1b1b1b`) and everything important sits on it as a slightly raised instrument:
mail surfaces at `#222222`, controls at `#2e2e2e`, hairlines at 8% white. There
is almost no colour, and what exists is functional — one warm signal light for the
activity board, a small set of Google-native status hues for unread and draft
mail, and a separate orange→violet→blue spectrum that marks anything
**machine-written**. That last distinction is the system's core idea: the operator
and the AI do not look the same.

The density is deliberately high and the type is deliberately small in the
working surfaces (10–13px labels, tabular numerals on every figure), because the
person at this desk is scanning, not reading. Marketing surfaces breathe more
(6xl display, 65–75ch body) but use the same palette, the same single typeface,
and the same flat, tonal layering.

Everything is one mode: dark. The palette is mirrored under `.dark` so the
surfaces stay identical whether or not the class is present. This is not a theme
toggle waiting to happen; it is a decision made from the use scene — a focused
operator, often after hours, in front of a screen full of mail.

**Key Characteristics:**

- Single dark palette anchored on `#1b1b1b`; hierarchy carried by tonal steps,
  not borders or big shadows.
- One UI typeface (Inter) across display, UI, and data, including the brand
  wordmark.
- One warm accent (`#f2b4cb`) reserved for activity/peak signal.
- A distinct AI gradient (`#ff5e00 → #8a43e1 → #1800e7`) that marks
  machine-authored content only.
- Flat-by-default surfaces; shadows appear as state (hover lift, rails, FAB).
- Dense, instrument-like app chrome with tabular numerals; breathing marketing
  pages on the same tokens.

## Colors

The palette is a near-monochrome dark instrument panel with exactly one warm
accent and a separate machine-authored spectrum.

### Primary

- **Paper White** (`#f4f4f5`): the primary token is *light*, not saturated. It is
  the fill and text colour of primary buttons, focus/selection foreground, and the
  strongest text. On this dark canvas it reads as the single bright material.
- **Canvas Black** (`#1b1b1b`): the ground everywhere. Also `--primary-foreground`
  — text on a Paper White button.

### Secondary

- **Blush Signal** (`#f2b4cb`): the only warm colour in the working UI. Reserved
  for the activity board's peak signal and active-tab underline; paired with
  **Blush Soft** (`#f7d2e0`) and **Blush Ink** (`#2b1622`) for on-accent text. It
  is a signal, never decoration.

### Tertiary

- **Operator Spectrum** (`#ff5e00` → `#8a43e1` → `#1800e7`): a linear gradient
  applied only to AI-authored affordances (the "Approve & Send" control and the
  frame around a machine-drafted body). Deliberately *not* the brand accent.

### Neutral

- **Card Surface** (`#222222`): content surfaces one step above canvas.
- **Muted Surface** (`#262626`) / **Accent Surface** (`#2e2e2e`): secondary and
  interactive surface steps; also `--muted` and `--accent`.
- **Hairline** (`rgba(255, 255, 255, 0.08)`): every divider and border. Borders are
  light-on-dark at 8%; never a solid grey.
- **Input Line** (`rgba(255, 255, 255, 0.12)`): input borders, a touch stronger
  than the divider.
- **Muted Ink** (`#a1a1aa`): secondary text, placeholders, metadata.
- **Status hues:** **Signal Blue** (`#8ab4f8`, unread / recipient), **Draft Coral**
  (`#f28b82`, drafts), **Attention Amber** (`#f8b84e`, star / warning).

### Named Rules

**The Tonal-First Rule.** Hierarchy is made with lightness steps
(`#1b1b1b → #222222 → #262626 → #2e2e2e`) before any border or shadow. A new
surface earns its separation from tone first; reach for a hairline only when two
tones meet.

**The One Warm Signal Rule.** Blush Signal appears on no more than one focal
element per screen. Its rarity is what makes it read.

**The Machine Gradient Rule.** The Operator Spectrum marks AI-authored content
and nothing else. It never becomes a brand accent or a decorative flourish.

## Typography

**Display Font:** Inter (with `ui-sans-serif`, `system-ui`, `-apple-system`,
`sans-serif`)
**Body Font:** Inter — the same family.
**Brand Wordmark:** Inter (same family), used as a gradient-clipped mark.
**Label/Mono Font:** none distinct; the system uses Inter at small sizes with
`tabular-nums` and wide tracking, not a monospace.

**Character:** One voice, everywhere. Inter keeps the app and the marketing page
in the same register and lets hierarchy come from size, weight, and tracking
rather than a font change. (The typeface is intentionally the familiar neutral
sans an Operate surface wants; it is not a place to introduce a decorative face.)

The **Tartly wordmark** uses Inter with a cool chrome-and-blush gradient and
tight tracking (`.tartly-wordmark`) so it reads as a logo. It is a mark, not a
voice — use it only where the name stands alone (lockups, loaders, the sidebar),
never for headlines or body copy.

### Hierarchy

- **Display** (600, `clamp(2.25rem, 6vw, 3.75rem)`, 1.05, tracking `-0.04em`):
  landing and CTA headlines only. Balanced (`text-balance`), never longer than a
  line or two.
- **Headline** (600, `clamp(1.5rem, 3vw, 1.875rem)`, 1.15, tracking `-0.03em`):
  section headings.
- **Title** (600, `1rem`, 1.4, tracking `-0.01em`): card and panel titles.
- **Body** (400, `1rem`, 1.6): marketing prose at 65–75ch; app body copy steps
  down to 12.5–14px to fit the density.
- **Label** (500, `0.625rem`, tracking `0.12em`, UPPERCASE): the instrument
  micro-label above stats and cells. Pair with `tabular-nums` for all numerals.

### Named Rules

**The One Voice Rule.** Inter is the only typeface, UI and brand mark alike. No
second display face, no monospace costume — data uses `tabular-nums` on Inter.
The **Tartly wordmark** stays in Inter too, distinguished only by its gradient
treatment.

**The Instrument Label Rule.** In the app shell, metadata is a 10px uppercase
label with `0.12em` tracking; figures sit next to it in tabular numerals.

## Layout

App surfaces use a flush, line-delimited grid rather than floating cards: the
activity board is a single `grid` of cells that share font/border rules (no
masonry, no rounded-float tiles), and every tile borrows its bottom and right
hairline from its neighbour. The mail client is a three-column composition —
navigation rail, message list, reader — with a collapsible assistant rail that
docks right (`--mail-assistant: #1d1d1d`, one step under the list surface so the
list pops). Marketing pages are centred columns: `max-w-3xl` hero, `max-w-6xl`
sections, `max-w-2xl` prose intros, with `py-20` section rhythm and a hairline
`border-t` between sections (`border-border/60`).

Density is the responsive dial. Working surfaces keep 10–13px type and tight
8–12px paddings; the shell collapses the sidebar and turns the assistant into a
full-screen overlay under `768px`. Radii, tones, and rules never change between
breakpoints.

## Elevation & Depth

Flat by default, tonal first. There is no ambient shadow on ordinary surfaces —
`#222222` on `#1b1b1b` with a 8% hairline does the work. Shadows are reserved for
things that actually leave the plane:

### Shadow Vocabulary

- **Row lift** (`0 12px 24px -14px rgba(0,0,0,0.9), 0 2px 6px -4px
  rgba(0,0,0,0.55)`): the mail row's hover lift. A shadow, never a size change, so
  neighbours don't move.
- **Row hairline** (`0 1px 0.5px rgba(0,0,0,0.4)`): the 1px bottom edge under a
  mail row.
- **Assistant rail** (`-16px 0 40px -28px rgba(0,0,0,0.7)`): a soft cast leftward
  from the docked assistant column.
- **Assistant modal** (`0 16px 40px -14px rgba(0,0,0,0.6), 0 6px 18px -10px
  rgba(0,0,0,0.45)`): the expanded assistant window.
- **FAB** (multi-layer, `0 3px 5px` … `0 35px 28px`, all `rgba(0,0,0,0.05)`):
  the floating compose affordance.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest. A shadow means the thing
is interactive or floating (hover lift, rail, FAB) — it is never decoration.

## Shapes

Soft, small radii on a single 10px base: `--radius` = 10px, with `6px` (sm),
`8px` (md), `10px` (lg) and `14px` (xl). Buttons and inputs use the 8px step;
cards and static containers use the 14px step. Full pills (`rounded-full`) are
reserved for primary marketing CTAs, tag chips, avatars, and status dots — not for
app buttons. Circles appear only as status dots and the loader's 2px bead matrix.
Clipping is always `overflow-hidden` at the radius; the system does not use cut
corners, hard/offset shadows, or colored side rules.

## Components

Character across the system: **precise and quiet**. States read as small factual
shifts — a tone step, an 80% fill, a one-pixel lift — never a performance.

### Buttons

- **Shape:** 8px radius (`rounded-md`), 36px default height, `border-transparent`.
- **Primary:** Paper White fill (`#f4f4f5`) with Canvas Black text; icon gap 6px;
  text 14px/500.
- **Hover / Focus:** hover drops the fill to 80% (`bg-primary/80`); focus is a
  3px `--ring` at 50% plus a ring-colored border; active translates down 1px.
- **Ghost / Outline:** transparent or canvas background with a hairline; hover
  steps to `--muted`. **Destructive:** a 10–20% destructive tint, not a solid red.

### Chips

- **Style:** `--accent` (`#2e2e2e`) pill with light text, 2×8px padding.
- **State:** mail labels use `--mail-tag-*` tone-on-tone pairs (e.g. Important
  `#4a2320` on `#f6aea9`); unread uses Signal Blue text.

### Cards / Containers

- **Corner Style:** 14px (`rounded-xl`).
- **Background:** `--card` (`#222222`).
- **Shadow Strategy:** flat; a 1px `ring-foreground/10` hairline instead (see
  Elevation).
- **Border:** none solid; ring or 8% border only.
- **Internal Padding:** 24px (`--spacing(6)`), 16px for the small size.

### Inputs / Fields

- **Style:** transparent background with a `--input` (12% white) hairline, 8px
  radius, 36px height; placeholder is `--muted-foreground`.
- **Focus:** `--ring` border plus a 3px 50% ring glow.
- **Error / Disabled:** destructive border/ring for invalid; 50% opacity and
  `cursor-not-allowed` for disabled.

### Navigation

Sidebar rails sit a step *under* the content surfaces (`#1d1d1d`) with the active
item at `--accent` (`#2e2e2e`); icons are 16–20px with a consistent stroke, labels
14px. The active mail-server tab is underlined in Blush Signal. Under 768px the
sidebar collapses and the assistant rail becomes a full-screen overlay with a
scrim.

### Signature: AI-authored surfaces

Machine-written content is marked in the palette, not with a decorative ramp. In
the composer, the agent's live chain-of-thought renders in the body area while it
works; once it delivers, that thread is replaced by the draft in a **square**
frame (`rounded-none`, generous inside padding) with a `--mail-recipient` border,
and "Approve & Send" takes the same bracketed `ClickPowerUp` treatment as "Write
with AI" — one size larger. `.surface-ai-gradient` (the Operator Spectrum) remains
the landing hero's signature; pair it with `--activity-accent` only on the activity
board, where the warm signal marks the peak.

### Signature: the dither-kit chart

Activity data is painted by a small first-party chart kit that renders series as
beads/dots (a 2px matrix loader shares the geometry). Charts live in a
self-contained palette (blue/pink/purple/orange/red plus a grey no-data step) and
use the system's hairlines and mono-spaced numerals; the warm `--activity-accent`
is used for the active underline, not the series.

### Signature: the Tartly wordmark

The signature is the gradient, not a second face. `TartlyWordmark`
(`components/shared/brand/tartly-wordmark.tsx`) sets "Tartly" in Inter at 700 with
`-0.045em` tracking and a single cool gradient — Blush Signal through near-white
to a cool grey — clipped to the text; it degrades to foreground ink where
`background-clip: text` is unsupported. It appears only in brand lockups (the
marketing `Brand`, the boot/`MatrixBrandMark`, and the sidebar header) and never
mid-sentence or as a headline treatment.

## Do's and Don'ts

### Do:

- **Do** separate surfaces by tone first (`#1b1b1b → #222222 → #262626 →
  #2e2e2e`) and reach for the 8% hairline only when tones meet.
- **Do** keep one typeface (Inter) and let size/weight/tracking carry hierarchy;
  distinguish the **Tartly wordmark** with its gradient treatment, not a new face.
- **Do** use `tabular-nums` for every figure and 10px uppercase `0.12em` labels
  for metadata.
- **Do** reserve Blush Signal (`#f2b4cb`) for a single focal element per screen.
- **Do** mark AI-authored content with the Operator Spectrum gradient so it never
  looks hand-written.
- **Do** keep shadows for state and floating elements (hover lift, rail, FAB).

### Don't:

- **Don't** introduce a second typeface, a light theme, or a theme toggle; the
  single dark palette is a use-scene decision.
- **Don't** use the Operator Spectrum as a brand accent or general decoration.
- **Don't** use `rounded-full` outside pills, tag chips, avatars, and status dots.
- **Don't** use gradient text except the single clipped gradient on the Tartly
  wordmark; never hard/offset shadows or colored side borders.
- **Don't** use borders or shadows as the first tool for hierarchy — that is the
  tonal ramp's job.
- **Don't** fabricate testimonials, customer logos, benchmarks, or press; none
  exist for this product.
