import { PageHeader } from "@/components/app-shell/page-header";
import { CalendarSettingsForm } from "@/components/settings/calendar-settings-form";
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
    <div className="flex h-full flex-col">
      <PageHeader
        title="Calendar"
        subtitle="When your assistant may book time on your behalf."
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <CalendarSettingsForm initial={initial} />
      </div>
    </div>
  );
}
