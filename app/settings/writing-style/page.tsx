import { SettingsPage } from "@/components/settings/settings-page";
import { WritingStyleSettingsSection } from "@/components/settings/sections/writing-style-section";

export default function WritingStyleSettingsPage() {
  return (
    <SettingsPage
      title="Voice & memory"
      subtitle="How your assistant writes — and what it remembers about you."
    >
      <WritingStyleSettingsSection />
    </SettingsPage>
  );
}
