import { notFound } from "next/navigation";

import { SettingsModal } from "@/components/settings/settings-modal";
import { AssetsSettingsSection } from "@/components/settings/sections/assets-section";
import { AutopilotSettingsSection } from "@/components/settings/sections/autopilot-section";
import { CalendarSettingsSection } from "@/components/settings/sections/calendar-section";
import { KnowledgeSettingsSection } from "@/components/settings/sections/knowledge-section";
import { RulesSettingsSection } from "@/components/settings/sections/rules-section";
import { SendersSettingsSection } from "@/components/settings/sections/senders-section";
import { WritingStyleSettingsSection } from "@/components/settings/sections/writing-style-section";

/**
 * The intercepted settings routes. A soft navigation to any `/settings/<slug>`
 * (or bare `/settings`) renders the matching section inside the glass modal
 * instead of the full-page layout. The section list mirrors `SETTINGS_GROUPS`,
 * and the real `app/settings/*` pages render the same bodies on a hard load.
 */
const SECTIONS = {
  calendar: {
    title: "Calendar",
    subtitle: "When your assistant may book time on your behalf.",
    Section: CalendarSettingsSection,
  },
  assets: {
    title: "Assets",
    subtitle: "Images and files you can reuse in mail and campaigns.",
    Section: AssetsSettingsSection,
  },
  "writing-style": {
    title: "Voice & memory",
    subtitle: "How your assistant writes — and what it remembers about you.",
    Section: WritingStyleSettingsSection,
  },
  knowledge: {
    title: "Knowledge & snippets",
    subtitle: "Facts the assistant can reuse, and shortcuts for text you repeat.",
    Section: KnowledgeSettingsSection,
  },
  senders: {
    title: "Senders",
    subtitle:
      "How the assistant classifies people and bulk mail, and how it handles cold outreach.",
    Section: SendersSettingsSection,
  },
  rules: {
    title: "Rules",
    subtitle:
      "Describe your automation in plain English; Lunabox runs it through the existing engine.",
    Section: RulesSettingsSection,
  },
  autopilot: {
    title: "24/7 Autopilot",
    subtitle:
      "Let Lunabox send safe replies on its own, inside the hours you choose.",
    Section: AutopilotSettingsSection,
  },
} as const;

type SectionKey = keyof typeof SECTIONS;

export default async function InterceptedSettingsPage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const { section } = await params;
  const [slug, ...rest] = section ?? [];
  const key = (slug ?? "calendar") as SectionKey;

  // Reject unknown sections and any trailing segments so the catch-all route
  // cannot silently swallow paths outside the settings rail.
  if (!(key in SECTIONS) || rest.length > 0) notFound();

  const { title, subtitle, Section } = SECTIONS[key];

  return (
    <SettingsModal title={title} subtitle={subtitle}>
      <Section />
    </SettingsModal>
  );
}
