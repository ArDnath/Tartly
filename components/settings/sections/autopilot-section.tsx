import {
  AutopilotSettingsForm,
  type AutopilotPolicyView,
} from "@/components/settings/autopilot-settings-form";
import { isAutopilotEnabled } from "@/lib/env";
import { requireSession } from "@/lib/session";
import {
  AUTOPILOT_CATEGORIES,
  AUTOPILOT_REASON_LABELS,
  getAutopilotPolicy,
} from "@/lib/settings/autopilot";

/** 24/7 Autopilot body, shared by the full settings page and the modal. */
export async function AutopilotSettingsSection() {
  const session = await requireSession();
  const policy = await getAutopilotPolicy(session.user.id);

  const initial: AutopilotPolicyView = {
    enabled: policy.enabled,
    mode: policy.mode,
    timezone: policy.timezone,
    days: policy.days,
    windowStartHour: policy.windowStartHour,
    windowEndHour: policy.windowEndHour,
    minConfidence: policy.minConfidence,
    requireKnownSender: policy.requireKnownSender,
    allowedCategories: policy.allowedCategories,
    maxPerHour: policy.maxPerHour,
    maxPerDay: policy.maxPerDay,
    maxPerThread: policy.maxPerThread,
    loopThreshold: policy.loopThreshold,
    morningReview: policy.morningReview,
  };

  return (
    <AutopilotSettingsForm
      initial={initial}
      globalEnabled={isAutopilotEnabled()}
      categories={AUTOPILOT_CATEGORIES}
      reasonLabels={AUTOPILOT_REASON_LABELS}
    />
  );
}
