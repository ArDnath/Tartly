import { SettingsPage } from "@/components/settings/settings-page";
import { SendersSettingsSection } from "@/components/settings/sections/senders-section";

export default function SendersSettingsPage() {
  return (
    <SettingsPage
      title="Senders"
      subtitle="How the assistant classifies people and bulk mail, and how it handles cold outreach."
    >
      <SendersSettingsSection />
    </SettingsPage>
  );
}
