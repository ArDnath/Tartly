import { AgentChat } from "@/components/assistant/agent-chat";
import { storedMessageToUIMessage } from "@/lib/agent/messages";
import { loadConversationMessages } from "@/lib/agent/persistence";
import { createChatThread, listChatThreads } from "@/lib/ai/chat-service";
import { requireSession } from "@/lib/session";

// Conversations are per-user state; never cache this render.
export const dynamic = "force-dynamic";

/**
 * The primary agent screen. Ensures the user has at least one conversation,
 * loads the selected (or most recent) one from our store, and hands the
 * rehydrated UI messages to the client.
 */
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const session = await requireSession();
  const { c } = await searchParams;

  let threads = await listChatThreads(session.user.id);
  if (threads.length === 0) {
    await createChatThread(session.user.id);
    threads = await listChatThreads(session.user.id);
  }

  const active = threads.find((thread) => thread.id === c) ?? threads[0];
  if (!active) {
    // A concurrent delete emptied the list between the re-list and here.
    // Render nothing rather than throwing on a non-null assertion.
    return null;
  }

  const stored = await loadConversationMessages(session.user.id, active.id);
  const initialMessages = stored.map(storedMessageToUIMessage);

  return (
    <AgentChat
      key={active.id}
      conversationId={active.id}
      initialMessages={initialMessages}
      threads={threads}
      title={active.title}
    />
  );
}
