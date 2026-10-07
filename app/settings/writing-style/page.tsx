import { SettingsPage } from "@/components/app/settings/settings-page";
import { WritingStyleSettingsSection } from "@/components/app/settings/sections/writing-style-section";
import { SETTINGS_SECTIONS } from "@/components/app/settings/settings-sections";

const { title, subtitle } = SETTINGS_SECTIONS["writing-style"];

export default function WritingStyleSettingsPage() {
  return (
    <SettingsPage title={title} subtitle={subtitle}>
      <WritingStyleSettingsSection />
    </SettingsPage>
  );
}
