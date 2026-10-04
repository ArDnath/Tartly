import { SettingsPage } from "@/components/settings/settings-page";
import { AssetsSettingsSection } from "@/components/settings/sections/assets-section";

export default function AssetsSettingsPage() {
  return (
    <SettingsPage
      title="Assets"
      subtitle="Images and files you can reuse in mail and campaigns."
    >
      <AssetsSettingsSection />
    </SettingsPage>
  );
}
