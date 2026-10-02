import { CalendarSettingsForm } from "@/components/settings/calendar-settings-form";
import { SettingsPage } from "@/components/settings/settings-page";
import {
  DEFAULT_CALENDAR_SETTINGS,
  getCalendarSettings,
} from "@/lib/calendar/settings";
import { requireSession } from "@/lib/session";

export default async function CalendarSettingsPage() {
  const session = await requireSession();
  const settings = await getCalendarSettings(session.user.id);

  const initial = settings
    ? {
        timezone: settings.timezone,
        workDays: settings.workDays,
        workStartHour: settings.workStartHour,
        workEndHour: settings.workEndHour,
        bufferMins: settings.bufferMins,
        defaultDurationMins: settings.defaultDurationMins,
      }
    : DEFAULT_CALENDAR_SETTINGS;

  return (
    <SettingsPage
      title="Calendar"
      subtitle="When your assistant may book time on your behalf."
    >
      <CalendarSettingsForm initial={initial} />
    </SettingsPage>
  );
}
