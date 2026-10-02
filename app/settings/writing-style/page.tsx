import { SettingsPage } from "@/components/settings/settings-page";
import { WritingStyleForm } from "@/components/settings/writing-style-form";
import { getAssistantOverview } from "@/lib/ai/features/draft-context";
import { listReplyMemories } from "@/lib/ai/features/reply-memory";
import { requireSession } from "@/lib/session";

export default async function WritingStyleSettingsPage() {
  const session = await requireSession();
  const [overview, memories] = await Promise.all([
    getAssistantOverview(session.user.id),
    listReplyMemories({ userId: session.user.id, limit: 100 }),
  ]);

  return (
    <SettingsPage
      title="Voice & memory"
      subtitle="How your assistant writes — and what it remembers about you."
    >
      <WritingStyleForm
        aiConfigured={overview.aiConfigured}
        initial={{
          voiceEnabled: overview.config.voiceEnabled,
          memoryEnabled: overview.config.memoryEnabled,
          knowledgeEnabled: overview.config.knowledgeEnabled,
          draftConfidence: overview.config.draftConfidence,
          explicitWritingStyle: overview.config.explicitWritingStyle,
          learnedWritingStyle: overview.config.learnedWritingStyle,
          briefingEnabled: overview.config.briefingEnabled,
          briefingHour: overview.config.briefingHour,
          commitmentsEnabled: overview.config.commitmentsEnabled,
          memoryAutoExtract: overview.config.memoryAutoExtract,
        }}
        initialMemories={memories.map((memory) => ({
          id: memory.id,
          kind: memory.kind,
          scopeType: memory.scopeType,
          scopeValue: memory.scopeValue,
          content: memory.content,
        }))}
      />
    </SettingsPage>
  );
}
