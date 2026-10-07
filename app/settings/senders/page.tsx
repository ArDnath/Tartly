import { SettingsPage } from "@/components/app/settings/settings-page";
import { SendersSettingsSection } from "@/components/app/settings/sections/senders-section";
import { SETTINGS_SECTIONS } from "@/components/app/settings/settings-sections";

const { title, subtitle } = SETTINGS_SECTIONS.senders;

export default function SendersSettingsPage() {
  return (
    <SettingsPage title={title} subtitle={subtitle}>
      <SendersSettingsSection />
    </SettingsPage>
  );
}
