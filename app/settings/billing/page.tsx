import { SettingsPage } from "@/components/app/settings/settings-page";
import { BillingSettingsSection } from "@/components/app/settings/sections/billing-section";
import { SETTINGS_SECTIONS } from "@/components/app/settings/settings-sections";

const { title, subtitle } = SETTINGS_SECTIONS.billing;

export const dynamic = "force-dynamic";

export default function BillingSettingsPage() {
  return (
    <SettingsPage title={title} subtitle={subtitle}>
      <BillingSettingsSection />
    </SettingsPage>
  );
}
