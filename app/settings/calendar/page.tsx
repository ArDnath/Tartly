import { SettingsPage } from "@/components/app/settings/settings-page";
import { CalendarSettingsSection } from "@/components/app/settings/sections/calendar-section";
import { SETTINGS_SECTIONS } from "@/components/app/settings/settings-sections";

const { title, subtitle } = SETTINGS_SECTIONS.calendar;

export default function CalendarSettingsPage() {
  return (
    <SettingsPage title={title} subtitle={subtitle}>
      <CalendarSettingsSection />
    </SettingsPage>
  );
}
