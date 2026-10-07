import { CalendarSettingsForm } from "@/components/app/settings/calendar-settings-form";
import {
  DEFAULT_CALENDAR_SETTINGS,
  getCalendarSettings,
} from "@/lib/calendar/settings";
import { requireSession } from "@/lib/session";

/**
 * Calendar settings body. Shared by the full `/settings/calendar` page and the
 * intercepted settings modal, so both render exactly the same form.
 */
export async function CalendarSettingsSection() {
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

  return <CalendarSettingsForm initial={initial} />;
}
