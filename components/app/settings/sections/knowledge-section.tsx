import { KnowledgeManager } from "@/components/app/settings/knowledge-manager";
import {
  listKnowledgeEntries,
  listSnippets,
} from "@/lib/ai/features/knowledge";
import { requireSession } from "@/lib/session";

/** Knowledge & snippets body, shared by the full settings page and the modal. */
export async function KnowledgeSettingsSection() {
  const session = await requireSession();
  const [entries, snippets] = await Promise.all([
    listKnowledgeEntries({ userId: session.user.id }),
    listSnippets({ userId: session.user.id }),
  ]);

  return (
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
  );
}
