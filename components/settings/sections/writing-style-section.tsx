import { WritingStyleForm } from "@/components/settings/writing-style-form";
import { getAssistantOverview } from "@/lib/ai/features/draft-context";
import { listReplyMemories } from "@/lib/ai/features/reply-memory";
import { requireSession } from "@/lib/session";

/** Voice & memory body, shared by the full settings page and the modal. */
export async function WritingStyleSettingsSection() {
  const session = await requireSession();
  const [overview, memories] = await Promise.all([
    getAssistantOverview(session.user.id),
    listReplyMemories({ userId: session.user.id, limit: 100 }),
  ]);

  return (
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
  );
}
