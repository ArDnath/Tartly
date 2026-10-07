import { SettingsPage } from "@/components/app/settings/settings-page";
import { RulesSettingsSection } from "@/components/app/settings/sections/rules-section";
import { SETTINGS_SECTIONS } from "@/components/app/settings/settings-sections";

const { title, subtitle } = SETTINGS_SECTIONS.rules;

export default function RulesSettingsPage() {
  return (
    <SettingsPage title={title} subtitle={subtitle}>
      <RulesSettingsSection />
    </SettingsPage>
  );
}
