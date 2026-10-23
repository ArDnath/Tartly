import { AccountsSettingsSection } from "@/components/app/settings/sections/accounts-section";
import { SettingsPage } from "@/components/app/settings/settings-page";
import { SETTINGS_SECTIONS } from "@/components/app/settings/settings-sections";

const { title, subtitle } = SETTINGS_SECTIONS.accounts;

export default function AccountsSettingsPage() {
  return (
    <SettingsPage title={title} subtitle={subtitle}>
      <AccountsSettingsSection />
    </SettingsPage>
  );
}
