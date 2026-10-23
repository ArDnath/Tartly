import type React from "react";

import { AccountsSettingsSection } from "@/components/app/settings/sections/accounts-section";
import { AssetsSettingsSection } from "@/components/app/settings/sections/assets-section";
import { AutopilotSettingsSection } from "@/components/app/settings/sections/autopilot-section";
import { BillingSettingsSection } from "@/components/app/settings/sections/billing-section";
import { CalendarSettingsSection } from "@/components/app/settings/sections/calendar-section";
import { KnowledgeSettingsSection } from "@/components/app/settings/sections/knowledge-section";
import { RulesSettingsSection } from "@/components/app/settings/sections/rules-section";
import { SendersSettingsSection } from "@/components/app/settings/sections/senders-section";
import { WritingStyleSettingsSection } from "@/components/app/settings/sections/writing-style-section";
import type { SettingsSectionSlug } from "@/components/app/settings/settings-sections";

/**
 * Section slug → body. Shared by the intercepted modal page and the canonical
 * `/settings/[[...section]]` full page so a soft navigation and a hard load
 * always render the same component.
 *
 * Server-only: the section bodies are server components. Do not import this
 * from a client component.
 */
export const SECTION_COMPONENTS: Record<
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
