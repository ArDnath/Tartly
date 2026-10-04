import { SettingsPage } from "@/components/settings/settings-page";
import { KnowledgeSettingsSection } from "@/components/settings/sections/knowledge-section";

export default function KnowledgeSettingsPage() {
  return (
    <SettingsPage
      title="Knowledge & snippets"
      subtitle="Facts the assistant can reuse, and shortcuts for text you repeat."
    >
      <KnowledgeSettingsSection />
    </SettingsPage>
  );
}
