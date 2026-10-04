import { SettingsPage } from "@/components/settings/settings-page";
import { CalendarSettingsSection } from "@/components/settings/sections/calendar-section";

export default function CalendarSettingsPage() {
  return (
    <SettingsPage
      title="Calendar"
      subtitle="When your assistant may book time on your behalf."
    >
      <CalendarSettingsSection />
    </SettingsPage>
  );
}
