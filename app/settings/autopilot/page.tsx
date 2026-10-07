import { SettingsPage } from "@/components/app/settings/settings-page";
import { AutopilotSettingsSection } from "@/components/app/settings/sections/autopilot-section";
import { SETTINGS_SECTIONS } from "@/components/app/settings/settings-sections";

const { title, subtitle } = SETTINGS_SECTIONS.autopilot;

export const dynamic = "force-dynamic";

export default function AutopilotSettingsPage() {
  return (
    <SettingsPage title={title} subtitle={subtitle}>
      <AutopilotSettingsSection />
    </SettingsPage>
  );
}
