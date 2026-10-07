import { SettingsPage } from "@/components/app/settings/settings-page";
import { KnowledgeSettingsSection } from "@/components/app/settings/sections/knowledge-section";
import { SETTINGS_SECTIONS } from "@/components/app/settings/settings-sections";

const { title, subtitle } = SETTINGS_SECTIONS.knowledge;

export default function KnowledgeSettingsPage() {
  return (
    <SettingsPage title={title} subtitle={subtitle}>
      <KnowledgeSettingsSection />
    </SettingsPage>
  );
}
