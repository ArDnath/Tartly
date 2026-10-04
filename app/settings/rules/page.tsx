import { SettingsPage } from "@/components/settings/settings-page";
import { RulesSettingsSection } from "@/components/settings/sections/rules-section";

export default function RulesSettingsPage() {
  return (
    <SettingsPage
      title="Rules"
      subtitle="Describe your automation in plain English; Lunabox runs it through the existing engine."
    >
      <RulesSettingsSection />
    </SettingsPage>
  );
}
