import { KnowledgeManager } from "@/components/settings/knowledge-manager";
import { SettingsPage } from "@/components/settings/settings-page";
import {
  listKnowledgeEntries,
  listSnippets,
} from "@/lib/ai/features/knowledge";
import { requireSession } from "@/lib/session";

export default async function KnowledgeSettingsPage() {
  const session = await requireSession();
  const [entries, snippets] = await Promise.all([
    listKnowledgeEntries({ userId: session.user.id }),
    listSnippets({ userId: session.user.id }),
  ]);

  return (
    <SettingsPage
      title="Knowledge & snippets"
      subtitle="Facts the assistant can reuse, and shortcuts for text you repeat."
    >
      <KnowledgeManager
        initialEntries={entries.map((entry) => ({
          id: entry.id,
          title: entry.title,
          content: entry.content,
        }))}
        initialSnippets={snippets.map((snippet) => ({
          id: snippet.id,
          shortcut: snippet.shortcut,
          content: snippet.content,
        }))}
      />
    </SettingsPage>
  );
}
