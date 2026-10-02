import { AgentChat } from "@/components/assistant/agent-chat";
import { storedMessageToUIMessage } from "@/lib/agent/messages";
import { loadConversationMessages } from "@/lib/agent/persistence";
import { createChatThread, listChatThreads } from "@/lib/ai/chat-service";
import { getCatchUp } from "@/lib/briefing/catchup";
import type { CatchUp } from "@/lib/briefing/catchup-types";
import { requireSession } from "@/lib/session";

// Conversations are per-user state; never cache this render.
export const dynamic = "force-dynamic";

const CATCH_UP_THREAD_TITLE = "Catch-up";

/**
 * The primary agent screen. Ensures the user has at least one conversation,
 * loads the selected (or most recent) one from our store, and hands the
 * rehydrated UI messages to the client.
 *
 * `?catchup=1` is the hand-off from the reload popup: it opens a fresh "Catch-up"
 * conversation and gives the client the plan of options to show in the empty
 * state. Choosing one sends a normal agent turn — the popup never writes to a
 * transcript on its own.
 */
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; catchup?: string }>;
}) {
  const session = await requireSession();
  const { c, catchup } = await searchParams;
  const wantsCatchUp = catchup === "1";

  let threads = await listChatThreads(session.user.id);
  if (threads.length === 0) {
    await createChatThread(session.user.id);
    threads = await listChatThreads(session.user.id);
  }

  let catchUpPlan: CatchUp | null = null;
  if (wantsCatchUp) {
    catchUpPlan = await getCatchUp(session.user.id).catch((error) => {
      console.warn("[assistant] catch-up compose failed", error);
      return null;
    });

    // Open a dedicated conversation for the plan so it is never mixed into an
    // existing transcript. Reuse the newest Catch-up thread only while it is
    // still untouched (a reload of the same hand-off); once it has messages,
    // start a fresh one so the plan is shown again.
    let catchUpThread =
      threads.find((thread) => thread.title === CATCH_UP_THREAD_TITLE) ?? null;
    let stored = catchUpThread
      ? await loadConversationMessages(session.user.id, catchUpThread.id)
      : [];

    if (!catchUpThread || stored.length > 0) {
      catchUpThread = await createChatThread(session.user.id, {
        title: CATCH_UP_THREAD_TITLE,
      });
      stored = [];
    }

    const target = catchUpThread;
    threads = [target, ...threads.filter((thread) => thread.id !== target.id)];

    return (
      <AgentChat
        key={target.id}
        conversationId={target.id}
        initialMessages={stored.map(storedMessageToUIMessage)}
        threads={threads}
        title={target.title}
        catchUpPlan={catchUpPlan}
      />
    );
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
