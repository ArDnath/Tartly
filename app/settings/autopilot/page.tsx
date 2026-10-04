import { SettingsPage } from "@/components/settings/settings-page";
import { AutopilotSettingsSection } from "@/components/settings/sections/autopilot-section";

export const dynamic = "force-dynamic";

export default function AutopilotSettingsPage() {
  return (
    <SettingsPage
      title="24/7 Autopilot"
      subtitle="Let Lunabox send safe replies on its own, inside the hours you choose."
    >
      <AutopilotSettingsSection />
    </SettingsPage>
  );
}
