"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type ChatStatus,
  type UIMessage,
} from "ai";
import { CircleAlertIcon, Clock, Globe, Plus, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { AgentMessage } from "@/components/app/assistant/agent-message";
import {
  openPaywall,
  usePaywallStore,
} from "@/components/app/paywall/paywall-store";
import {
  AgentChatActionsProvider,
  type AgentChatActions,
} from "@/components/app/assistant/agent-chat-actions";
import { ApprovalDock, collectPendingApprovals } from "@/components/app/assistant/approval-dock";
import { AutonomySwitch } from "@/components/app/assistant/mailbox-autonomy";
import { CatchUpPlan } from "@/components/app/briefing/catch-up-plan";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatThread } from "@/lib/ai/chat-types";
import type { CatchUp } from "@/lib/briefing/catchup-types";
import { cn } from "@/lib/utils";

function textOf(message: UIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

/**
 * Collapse messages that share an id down to one entry.
 *
 * `useChat` keys the transcript by `message.id`; the AI SDK can, in
 * "continuation" flows, emit a response under an id that already exists in the
 * list (it is meant to *replace* that message, but the client can end up
 * appending it). Rendering both is what React warns about as duplicate keys.
 * This keeps the first-seen position with the most recent content for each id,
 * so the transcript stays ordered and no key repeats.
 */
function dedupeMessagesById(messages: UIMessage[]): UIMessage[] {
  const latestById = new Map<string, UIMessage>();
  for (const message of messages) latestById.set(message.id, message);
  if (latestById.size === messages.length) return messages;

  const seen = new Set<string>();
  const deduped: UIMessage[] = [];
  for (const message of messages) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    deduped.push(latestById.get(message.id) ?? message);
  }
  return deduped;
}

/**
 * The agent conversation surface.
 *
 * `useChat` speaks the AI SDK UI message stream directly, so tool calls and
 * results arrive as typed parts and render through the AI Elements components.
 * History is seeded from the server; the request body carries only the new turn
 * plus the conversation id — the server never trusts client-supplied history.
 *
 * The component is placement-agnostic: on `/assistant` it owns navigation
 * (creating and selecting conversations via the router), while inside the mail
 * side panel the parent supplies `onNewChat` / `onSelectConversation` so
 * switching conversations stays in place. `onAssistantTurnEnd` lets a host
 * refresh whatever live data the agent's tools may have changed.
 */
export function AgentChat({
  conversationId,
  initialMessages,
  threads,
  title,
  onNewChat,
  onSelectConversation,
  onAssistantTurnEnd,
  className,
  showTitle = true,
  emptyTitle = "What should we do with your inbox?",
  emptyDescription = "Try “Find my latest email from John”, “Summarize my unread mail”, or “Search threads about pricing”.",
  catchUpPlan = null,
}: {
  conversationId: string;
  initialMessages: UIMessage[];
  threads: ChatThread[];
  title: string | null;
  /** Override the default "create a thread and navigate" behavior. */
  onNewChat?: () => void | Promise<void>;
  /** Override the default "navigate to the thread" behavior. */
  onSelectConversation?: (threadId: string) => void;
  /** Called when a run settles (Streaming → Ready), tools included. */
  onAssistantTurnEnd?: () => void;
  className?: string;
  /**
   * Render the in-surface title row (icon + thread name). Hosts that already
   * show the thread name elsewhere — like the mail side panel's rail header —
   * set this to `false` to avoid repeating it.
   */
  showTitle?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  /**
   * The catch-up plan to show in place of the empty state. Set by the popup
   * hand-off — in the mail sidebar (in place) or on `/assistant?catchup=1`;
   * each option sends a real agent turn.
   */
  catchUpPlan?: CatchUp | null;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [input, setInput] = useState("");
  /**
   * Composer toggle: let the agent search the public web this turn. Off by
   * default keeps each request small and predictable; on unlocks the research
   * tools (`search_web`, `open_web_page`, `research_person/company`).
   */
  const [webSearch, setWebSearch] = useState(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/v1/agent/chat",
        prepareSendMessagesRequest: ({ messages, body }) => {
          const last = messages[messages.length - 1];
          return {
            body: {
              ...(body ?? {}),
              conversationId,
              text: textOf(last),
            },
          };
        },
      }),
    [conversationId],
  );

  const { messages, sendMessage, status, stop, error, clearError } = useChat({
    id: conversationId,
    messages: initialMessages,
    transport,
    onError: (chatError) => {
      // The entitlement may not have loaded when the first turn was sent; if the
      // server answered `402`, surface the paywall instead of a raw error. A
      // `credits` reason means a topped-out subscriber, not a free user.
      const message = String(chatError?.message ?? "");
      if (message.includes("payment_required")) {
        openPaywall(message.includes("credits") ? "credits" : "ai");
      }
    },
  });

  const isBusy: boolean = status === "submitted" || status === "streaming";

  /**
   * Every entry into the agent is subscriber-only. The server enforces this too
   * (the route is `requiresSubscription`); this gate makes the wall instant and
   * keeps free users out of the chat before a request is even made.
   */
  const ensureSubscribed = () => {
    const entitlement = usePaywallStore.getState().entitlement;
    if (entitlement && !entitlement.isSubscriber) {
      openPaywall("ai");
      return false;
    }
    return true;
  };

  // Continue the turn after the user decides on a confirmation card. The empty
  // text turn is filtered from rendering; the server keys off `resumeActionId`
  // and feeds the action outcome back as hidden context.
  const resumeAfterAction = useCallback(
    (actionId: string) => {
      void sendMessage(
        { text: "" },
        { body: { resumeActionId: actionId, webSearch } },
      );
    },
    [sendMessage, webSearch],
  );

  const agentActions = useMemo<AgentChatActions>(
    () => ({ resumeAfterAction }),
    [resumeAfterAction],
  );

  // A resume turn is sent with empty text (the server keys off `resumeActionId`);
  // hide that placeholder bubble so the continuation looks seamless.
  const visibleMessages = useMemo(
    () =>
      dedupeMessagesById(
        messages.filter(
          (message) =>
            !(message.role === "user" && textOf(message).trim().length === 0),
        ),
      ),
    [messages],
  );

  // Approvals that were already in the transcript when this conversation was
  // seeded. Those are historical: replaying them as a pinned tray the instant a
  // thread opens — or the app starts on the most recent thread — is the
  // surprise this component exists to avoid. The tray is reserved for the live
  // turn: approvals the model parks while it is actually reasoning here.
  // Lazy state (not a ref) so it is captured once yet still readable in render.
  const [seededApprovalIds] = useState(
    () =>
      new Set(
        collectPendingApprovals(initialMessages).map((approval) => approval.id),
      ),
  );

  // Side effects the server parked for approval during this session. These
  // render in a pinned tray above the composer, so the user never has to scroll
  // the transcript to find the action they are being asked to approve.
  const pendingApprovals = useMemo(
    () =>
      collectPendingApprovals(messages).filter(
        (approval) => !seededApprovalIds.has(approval.id),
      ),
    [messages, seededApprovalIds],
  );

  /** Approval ids the dock is currently showing, for the inline transcript cue. */
  const liveApprovalIds = useMemo(
    () => new Set(pendingApprovals.map((approval) => approval.id)),
    [pendingApprovals],
  );

  // Notify the host once a run has settled, so it can refresh live data the
  // agent's tools may have changed (e.g. the mail store after an archive).
  const previousStatus = useRef(status);
  useEffect(() => {
    const wasBusy =
      previousStatus.current === "submitted" ||
      previousStatus.current === "streaming";
    const nowBusy = status === "submitted" || status === "streaming";
    if (wasBusy && !nowBusy) onAssistantTurnEnd?.();
    previousStatus.current = status;
  }, [status, onAssistantTurnEnd]);

  const startNewChat = async () => {
    if (!ensureSubscribed()) return;
    try {
      if (onNewChat) {
        await onNewChat();
        return;
      }
      if (creating) return;
      setCreating(true);
      const response = await fetch("/api/ai/threads", { method: "POST" });
      if (!response.ok) return;
      const payload = (await response.json()) as { thread: ChatThread };
      router.push(`/assistant?c=${payload.thread.id}`);
      router.refresh();
    } catch (error) {
      // Fired as `void startNewChat()` from the button/header, so never let it
      // surface as an unhandled rejection.
      console.error("[agent-chat] failed to start a new chat", error);
    } finally {
      setCreating(false);
    }
  };

  const openConversation = (threadId: string) => {
    if (onSelectConversation) {
      onSelectConversation(threadId);
      return;
    }
    router.push(`/assistant?c=${threadId}`);
    router.refresh();
  };

  return (
    <AgentChatActionsProvider value={agentActions}>
      <div className={cn("relative flex h-full min-h-0 flex-1 flex-col", className)}>
      {showTitle ? (
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate text-sm font-medium text-foreground">
              {title || "New chat"}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {threads.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label="Conversation history"
                      title="History"
                    >
                      <Clock className="size-4" aria-hidden />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="w-64">
                  {threads.map((thread) => (
                    <DropdownMenuItem
                      key={thread.id}
                      onClick={() => openConversation(thread.id)}
                    >
                      <span className="truncate">
                        {thread.title ?? "New chat"}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void startNewChat()}
              disabled={creating || isBusy}
            >
              <Plus className="size-4" />
              New chat
            </Button>
          </div>
        </header>
      ) : (
        // Embedded in the mail panel: the same controls collapse into a small
        // cluster floating in the conversation's top-right corner, so the
        // transcript keeps the full height instead of paying for a header row.
        <div className="pointer-events-none absolute top-2 right-2 z-20">
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border/70 bg-background/80 p-0.5 shadow-sm backdrop-blur">
            {threads.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Conversation history"
                      title="History"
                    >
                      <Clock className="size-3.5" aria-hidden />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="w-64">
                  {threads.map((thread) => (
                    <DropdownMenuItem
                      key={thread.id}
                      onClick={() => openConversation(thread.id)}
                    >
                      <span className="truncate">
                        {thread.title ?? "New chat"}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="New chat"
              title="New chat"
              onClick={() => void startNewChat()}
              disabled={creating || isBusy}
            >
              <Plus className="size-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      )}

      <Conversation className="min-h-0 flex-1">
        <ConversationContent className={cn(!showTitle && "pt-12")}>
          {visibleMessages.length === 0 ? (
            catchUpPlan ? (
              <CatchUpPlan
                catchUp={catchUpPlan}
                disabled={isBusy}
                onSelect={(option) => {
                  if (!ensureSubscribed()) return;
                  setInput("");
                  void sendMessage({ text: option.prompt }, { body: { webSearch } });
                }}
              />
            ) : (
              <ConversationEmptyState
                title={emptyTitle}
                description={emptyDescription}
              />
            )
          ) : (
            visibleMessages.map((message, index) => (
              <AgentMessage
                key={message.id}
                message={message}
                liveApprovalIds={liveApprovalIds}
                isStreaming={
                  status === "streaming" &&
                  index === visibleMessages.length - 1 &&
                  message.role === "assistant"
                }
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {error ? (
        <div className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">
          <span className="flex min-w-0 items-center gap-2">
            <CircleAlertIcon
              className="size-4 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden
            />
            <span className="min-w-0 truncate">
              {error.message || "The assistant failed to respond."}
            </span>
          </span>
          <Button variant="ghost" size="sm" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="shrink-0 p-3">
        <ApprovalDock approvals={pendingApprovals} />
        <PromptInput
          onSubmit={({ text }) => {
            const trimmed = text.trim();
            if (!trimmed) return;
            if (!ensureSubscribed()) return;
            setInput("");
            void sendMessage({ text: trimmed }, { body: { webSearch } });
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea
              placeholder="Ask about your email…"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <AutonomySwitch />
              <button
                type="button"
                onClick={() => setWebSearch((value) => !value)}
                aria-pressed={webSearch}
                title={
                  webSearch
                    ? "Web search is on — the agent can search the public web"
                    : "Web search is off"
                }
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
                  webSearch
                    ? "border-transparent bg-foreground text-background hover:bg-foreground/80"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <Globe className="size-3.5" aria-hidden />
                Web
              </button>
            </PromptInputTools>
            <PromptInputSubmit
              status={status as ChatStatus}
              onStop={stop}
              // Disable only when there is nothing to send; never tie this to
              // `messages.length`, which kept the first message of a new
              // conversation from ever being sendable.
              disabled={!isBusy && input.trim().length === 0}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
    </AgentChatActionsProvider>
  );
}
