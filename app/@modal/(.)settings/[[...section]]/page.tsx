import { notFound } from "next/navigation";

import { AccountsSettingsSection } from "@/components/app/settings/sections/accounts-section";
import { AssetsSettingsSection } from "@/components/app/settings/sections/assets-section";
import { AutopilotSettingsSection } from "@/components/app/settings/sections/autopilot-section";
import { BillingSettingsSection } from "@/components/app/settings/sections/billing-section";
import { CalendarSettingsSection } from "@/components/app/settings/sections/calendar-section";
import { KnowledgeSettingsSection } from "@/components/app/settings/sections/knowledge-section";
import { RulesSettingsSection } from "@/components/app/settings/sections/rules-section";
import { SendersSettingsSection } from "@/components/app/settings/sections/senders-section";
import { WritingStyleSettingsSection } from "@/components/app/settings/sections/writing-style-section";
import {
  DEFAULT_SETTINGS_SECTION,
  type SettingsSectionSlug,
} from "@/components/app/settings/settings-sections";

/**
 * The intercepted settings routes. A soft navigation to any `/settings/<slug>`
 * (or bare `/settings`) renders the matching section inside the glass modal
 * instead of the full-page layout. The section list mirrors `SETTINGS_GROUPS`,
 * and the real `app/settings/*` pages render the same bodies on a hard load.
 *
 * The modal chrome itself lives in the sibling `layout.tsx`; this page only
 * resolves and renders the section body, so section changes never remount the
 * panel.
 */
const SECTION_COMPONENTS: Record<
  SettingsSectionSlug,
  () => Promise<React.JSX.Element>
> = {
  accounts: AccountsSettingsSection,
  billing: BillingSettingsSection,
  calendar: CalendarSettingsSection,
  assets: AssetsSettingsSection,
  "writing-style": WritingStyleSettingsSection,
  knowledge: KnowledgeSettingsSection,
  senders: SendersSettingsSection,
  rules: RulesSettingsSection,
  autopilot: AutopilotSettingsSection,
};

export default async function InterceptedSettingsPage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const { section } = await params;
  const [slug, ...rest] = section ?? [];
  const key = (slug ?? DEFAULT_SETTINGS_SECTION) as SettingsSectionSlug;

  // Reject unknown sections and any trailing segments so the catch-all route
  // cannot silently swallow paths outside the settings rail.
  if (!(key in SECTION_COMPONENTS) || rest.length > 0) notFound();

  const Section = SECTION_COMPONENTS[key];

  return <Section />;
}
