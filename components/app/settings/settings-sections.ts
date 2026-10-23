/**
 * Human-facing copy for every settings section, keyed by URL slug.
 *
 * Deliberately free of server-only imports: the intercepted modal is a client
 * component and needs the current section's title/subtitle for its header,
 * while the server routes need the same copy for the full-page frame. Keeping
 * one map here means the two never drift.
 */
export const SETTINGS_SECTIONS = {
  billing: {
    title: "Billing & credits",
    subtitle:
      "Your plan, renewal date, AI credits and payment history — all in one place.",
  },
  accounts: {
    title: "Connected accounts",
    subtitle:
      "Connect or reconnect Gmail and Outlook — every inbox lands in one shared mail view.",
  },
  calendar: {
    title: "Calendar",
    subtitle: "When your assistant may book time on your behalf.",
  },
  assets: {
    title: "Assets",
    subtitle: "Images and files you can reuse in mail and campaigns.",
  },
  "writing-style": {
    title: "Voice & memory",
    subtitle: "How your assistant writes — and what it remembers about you.",
  },
  knowledge: {
    title: "Knowledge & snippets",
    subtitle: "Facts the assistant can reuse, and shortcuts for text you repeat.",
  },
  senders: {
    title: "Senders",
    subtitle:
      "How the assistant classifies people and bulk mail, and how it handles cold outreach.",
  },
  rules: {
    title: "Rules",
    subtitle:
      "Describe your automation in plain English; Tartly runs it through the existing engine.",
  },
  autopilot: {
    title: "24/7 Autopilot",
    subtitle:
      "Let Tartly send safe replies on its own, inside the hours you choose.",
  },
} as const;

export type SettingsSectionSlug = keyof typeof SETTINGS_SECTIONS;

/** The section `/settings` (with no slug) resolves to. */
export const DEFAULT_SETTINGS_SECTION: SettingsSectionSlug = "calendar";

/**
 * Resolve the section a `/settings/<slug>` pathname points at. Unknown or
 * missing slugs fall back to the default, mirroring the intercepted route's
 * behaviour so the header copy always matches the body.
 */
export function settingsSectionForPath(pathname: string): {
  slug: SettingsSectionSlug;
  title: string;
  subtitle: string;
} {
  const slug = pathname.split("/")[2] ?? "";
  const key: SettingsSectionSlug =
    slug in SETTINGS_SECTIONS
      ? (slug as SettingsSectionSlug)
      : DEFAULT_SETTINGS_SECTION;

  return { slug: key, ...SETTINGS_SECTIONS[key] };
}
