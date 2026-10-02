import { SenderIntelligence } from "@/components/settings/sender-intelligence";
import { SettingsPage } from "@/components/settings/settings-page";
import { getAssistantSettings } from "@/lib/ai/features/draft-context";
import {
  getSenderCategoryCounts,
  listSenderProfiles,
} from "@/lib/ai/features/sender-profiles";
import { requireSession } from "@/lib/session";

export default async function SendersSettingsPage() {
  const session = await requireSession();
  const userId = session.user.id;

  const [config, senders, counts] = await Promise.all([
    getAssistantSettings(userId),
    listSenderProfiles({ userId, limit: 300 }),
    getSenderCategoryCounts(userId),
  ]);

  return (
    <SettingsPage
      title="Senders"
      subtitle="How the assistant classifies people and bulk mail, and how it handles cold outreach."
    >
      <SenderIntelligence
        initialSettings={{
          senderIntelEnabled: config.senderIntelEnabled,
          coldEmailAction: config.coldEmailAction,
          autoArchiveNoise: config.autoArchiveNoise,
        }}
        initialSenders={senders.map((sender) => ({
          id: sender.id,
          email: sender.email,
          domain: sender.domain,
          category: sender.category,
          confidence: sender.confidence,
          coldEmailScore: sender.coldEmailScore,
          marketingScore: sender.marketingScore,
          status: sender.status,
          unsubscribeMethod: sender.unsubscribeMethod,
          lastSeenAt: sender.lastSeenAt.toISOString(),
        }))}
        initialCounts={counts.map((entry) => ({
          category: entry.category,
          total: entry.total,
        }))}
      />
    </SettingsPage>
  );
}
