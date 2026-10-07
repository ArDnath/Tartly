import { SettingsPage } from "@/components/app/settings/settings-page";
import { AssetsSettingsSection } from "@/components/app/settings/sections/assets-section";
import { SETTINGS_SECTIONS } from "@/components/app/settings/settings-sections";

const { title, subtitle } = SETTINGS_SECTIONS.assets;

export default function AssetsSettingsPage() {
  return (
    <SettingsPage title={title} subtitle={subtitle}>
      <AssetsSettingsSection />
    </SettingsPage>
  );
}
