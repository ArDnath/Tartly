"use client";

import { ChevronsLeft, ChevronsRight, Loader2, Plus } from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { UIMessage } from "ai";

import { AiChatMessageList } from "@/components/ai-chat/ai-chat-message-list";
import { useOptionalAiChat } from "@/components/ai-chat/ai-chat-provider";
import { AgentChat } from "@/components/assistant/agent-chat";
import {
  ASSISTANT_CLOSE_EVENT,
  ASSISTANT_OPEN_EVENT,
} from "@/components/assistant/assistant-events";
import { useMailStore } from "@/components/mail/mail-store";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChatThread } from "@/lib/ai/chat-types";
import { useStoredBoolean } from "@/lib/use-stored-boolean";
import { useStoredNumber } from "@/lib/use-stored-number";
import { cn } from "@/lib/utils";

/**
 * The mail screen's assistant panel — the single, primary agent surface.
 *
 * It hosts the same `AgentChat` runtime as the dedicated page, so the model can
 * call every registered tool (search, draft, label, archive, send, reply,
 * schedule, …). Sending and other external effects still route through a
 * persisted confirmation card the user must approve.
 *
 * On first-run onboarding the ambient chat provider streams the workspace-setup
 * welcome; while that thread is active the panel renders it (its "Welcome to
 * Redape" preamble is the target the halftone overlay title flies into) and
 * offers a hand-off into the agent.
 *
 * It is a client-only surface: the agent's tools mutate live Gmail, so after
 * every settled run the panel refreshes the mail store to reflect the change.
 */

const EMPTY_HISTORY: ChatThread[] = [];

/** Panel geometry. The width is remembered across visits. */
const PANEL_WIDTH_KEY = "redape.assistant.mail.width";
const DEFAULT_PANEL_WIDTH = 400;
const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 760;
const COLLAPSED_PANEL_WIDTH = 48;
/** How much room the mail list keeps to the left of the panel. */
const MAIL_MIN_WIDTH = 340;

function clampPanelWidth(next: number): number {
  const viewport = typeof window === "undefined" ? 1280 : window.innerWidth;
  const max = Math.max(
    MIN_PANEL_WIDTH,
    Math.min(MAX_PANEL_WIDTH, viewport - MAIL_MIN_WIDTH),
  );
  return Math.min(Math.max(Math.round(next), MIN_PANEL_WIDTH), max);
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

export function MailAgentPanel() {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useStoredBoolean("redape.assistant.mail.open", false);

  // Panel width: `storedWidth` is the persisted value, `dragWidth` the live
  // value during a drag. Rendering off `dragWidth ?? storedWidth` keeps the
  // drag smooth without writing to localStorage on every pointer move.
  const [storedWidth, setStoredWidth] = useStoredNumber(
    PANEL_WIDTH_KEY,
    DEFAULT_PANEL_WIDTH,
  );
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const liveWidthRef = useRef(storedWidth);

  const panelWidth = clampPanelWidth(dragWidth ?? storedWidth);

  // Keep a restored width inside the viewport as the window shrinks.
  useEffect(() => {
    const onWindowResize = () => {
      setStoredWidth((current) => clampPanelWidth(current));
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [setStoredWidth]);

  const commitWidth = useCallback(
    (next: number) => {
      const clamped = clampPanelWidth(next);
      liveWidthRef.current = clamped;
      setStoredWidth(clamped);
    },
    [setStoredWidth],
  );

  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startWidth: panelWidth };
    liveWidthRef.current = panelWidth;
    setResizing(true);
  };

  const onResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    // The panel is on the right, so dragging left widens it.
    const next = clampPanelWidth(
      drag.startWidth + (drag.startX - event.clientX),
    );
    liveWidthRef.current = next;
    setDragWidth(next);
  };

  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setResizing(false);
    setDragWidth(null);
    setStoredWidth(liveWidthRef.current);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture was already released — nothing to do.
    }
  };

  const onResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    commitWidth(panelWidth + (event.key === "ArrowLeft" ? 24 : -24));
  };

  /**
   * The screen-level chat provider (mounted by the mail layout). When present,
   * it owns the first-run workspace-setup thread whose welcome preamble is the
   * halftone overlay's flight target.
   */
  const sharedChat = useOptionalAiChat();

  // First-run onboarding: the ambient provider streams the workspace-setup
  // welcome thread. While it is active, the panel shows that conversation
  // (its preamble is the halftone title's flight target) instead of the agent.
  const showingWelcome = Boolean(sharedChat?.currentThread?.isWorkspaceSetup);

  const [threads, setThreads] = useState<ChatThread[]>(EMPTY_HISTORY);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Guards against a slow conversation load overwriting a newer selection. */
  const loadTokenRef = useRef(0);

  /** Non-setup conversations only: the onboarding thread is not an agent chat. */
  const fetchThreads = useCallback(async (): Promise<ChatThread[]> => {
    const response = await fetch("/api/ai/threads", { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to load conversations.");
    const payload = (await response.json()) as { threads: ChatThread[] };
    return payload.threads.filter((thread) => !thread.isWorkspaceSetup);
  }, []);

  const createThread = useCallback(async (): Promise<ChatThread> => {
    const response = await fetch("/api/ai/threads", { method: "POST" });
    if (!response.ok) throw new Error("Failed to start a new conversation.");
    const payload = (await response.json()) as { thread: ChatThread };
    return payload.thread;
  }, []);

  const loadConversation = useCallback(
    async (threadId: string): Promise<UIMessage[]> => {
      const response = await fetch(
        `/api/v1/agent/conversations/${threadId}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Failed to load this conversation.");
      const payload = (await response.json()) as {
        data: { conversation: ChatThread; messages: UIMessage[] };
      };
      return payload.data.messages;
    },
    [],
  );

  const selectThread = useCallback(
    (threadId: string) => {
      if (threadId === activeThreadId) return;
      const token = ++loadTokenRef.current;
      setError(null);
      setReady(false);
      setActiveThreadId(threadId);
      void loadConversation(threadId)
        .then((messages) => {
          if (loadTokenRef.current !== token) return;
          setInitialMessages(messages);
        })
        .catch((loadError: unknown) => {
          if (loadTokenRef.current !== token) return;
          console.error("[mail-agent] failed to load conversation", loadError);
          setError("Failed to load this conversation.");
        })
        .finally(() => {
          if (loadTokenRef.current === token) setReady(true);
        });
    },
    [activeThreadId, loadConversation],
  );

  const newChat = useCallback(async () => {
    setError(null);
    try {
      const thread = await createThread();
      loadTokenRef.current += 1;
      setThreads((current) => [
        thread,
        ...current.filter((candidate) => candidate.id !== thread.id),
      ]);
      setInitialMessages([]);
      setReady(true);
      setActiveThreadId(thread.id);
    } catch (createError) {
      console.error("[mail-agent] failed to create conversation", createError);
      setError("Failed to start a new conversation.");
    }
  }, [createThread]);

  // First load: reuse the most recent conversation, or start one.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        let list = await fetchThreads();

        let active = list[0];
        if (!active) {
          active = await createThread();
          list = [active];
        }

        if (cancelled) return;
        setThreads(list);
        setActiveThreadId(active.id);
        const messages = await loadConversation(active.id);
        if (cancelled) return;
        setInitialMessages(messages);
        setReady(true);
      } catch (loadError) {
        if (cancelled) return;
        console.error("[mail-agent] failed to initialize", loadError);
        setError("The assistant is unavailable right now.");
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [createThread, fetchThreads, loadConversation]);

  // The welcome flow asks the assistant pane to open (it is the assistant
  // surface on this screen), so listen for the cross-component signal.
  useEffect(() => {
    const onOpenAssistant = () => setOpen(true);
    window.addEventListener(ASSISTANT_OPEN_EVENT, onOpenAssistant);
    return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, onOpenAssistant);
  }, [setOpen]);

  // Tapping an email preview while the panel covers a phone screen should
  // reveal the reader. Desktop keeps the panel open.
  useEffect(() => {
    const onCloseAssistant = () => {
      if (window.matchMedia("(max-width: 767px)").matches) setOpen(false);
    };
    window.addEventListener(ASSISTANT_CLOSE_EVENT, onCloseAssistant);
    return () =>
      window.removeEventListener(ASSISTANT_CLOSE_EVENT, onCloseAssistant);
  }, [setOpen]);

  // Auto-open on desktop the first time this screen is seen.
  useEffect(() => {
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    if (window.localStorage.getItem("redape.assistant.mail.open") === null) {
      setOpen(true);
    }
  }, [setOpen]);

  // The welcome conversation must be visible for the overlay to hand off into,
  // even if the open event fired before this lazily loaded panel mounted.
  useEffect(() => {
    if (showingWelcome) setOpen(true);
  }, [showingWelcome, setOpen]);

  /** A settled run may have archived, labelled or sent: re-read live Gmail. */
  const onAssistantTurnEnd = useCallback(() => {
    void useMailStore.getState().load();
    void fetchThreads()
      .then(setThreads)
      .catch(() => {
        // A history refresh failure is non-fatal; the transcript stays.
      });
  }, [fetchThreads]);

  const activeTitle =
    threads.find((thread) => thread.id === activeThreadId)?.title ?? null;

  const body = showingWelcome ? (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The workspace-setup welcome renders inside the agent panel so its
          "Welcome to Redape" preamble is both the visible greeting and the
          halftone title's flight target. */}
      <AiChatMessageList />
      <div className="shrink-0 border-t border-border p-3">
        <Button
          type="button"
          className="w-full"
          onClick={() => sharedChat?.startNewChat()}
        >
          <Plus className="size-4" />
          Start with your agent
        </Button>
      </div>
    </div>
  ) : !ready ? (
    <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
    </div>
  ) : error && !activeThreadId ? (
    <p className="p-4 text-sm text-muted-foreground">{error}</p>
  ) : activeThreadId ? (
    <AgentChat
      key={activeThreadId}
      conversationId={activeThreadId}
      initialMessages={initialMessages}
      threads={threads}
      title={activeTitle}
      showTitle={false}
      onNewChat={newChat}
      onSelectConversation={selectThread}
      onAssistantTurnEnd={onAssistantTurnEnd}
      emptyTitle="Your mail, handled"
      emptyDescription="Ask me to find, summarize, draft, label, archive or send. I can work across your live Gmail — sending and other irreversible actions wait for your confirmation."
    />
  ) : null;

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open assistant"
          title="Open assistant"
          className="fixed top-1/2 right-0 z-30 flex h-32 w-11 -translate-y-1/2 flex-col items-center gap-2 rounded-l-lg border border-r-0 border-border bg-mail-assistant/95 py-2 text-muted-foreground shadow-rail backdrop-blur transition-colors hover:text-foreground md:hidden"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border">
            <Image
              src="/assitantlogo.png"
              alt=""
              width={28}
              height={28}
              className="size-6 shrink-0 object-contain"
            />
          </span>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border">
            <ChevronsLeft className="size-5 shrink-0" aria-hidden />
          </span>
        </button>
      ) : null}

      {open ? (
        <button
          type="button"
          aria-label="Close assistant"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
        />
      ) : null}

      <aside
        key={isDesktop ? "desktop" : "mobile"}
        aria-label="Mail assistant"
        aria-hidden={!open && !isDesktop}
        inert={!open && !isDesktop}
        style={
          isDesktop
            ? {
                width: open ? panelWidth : COLLAPSED_PANEL_WIDTH,
                transition: resizing
                  ? "none"
                  : "width 240ms cubic-bezier(0.16, 1, 0.3, 1)",
              }
            : undefined
        }
        className={cn(
          "fixed inset-y-0 right-0 z-40 w-full bg-mail-assistant transition-transform duration-300 ease-out max-md:border-l max-md:border-border max-md:max-w-[440px]",
          open ? "max-md:translate-x-0" : "max-md:translate-x-full",
          "md:relative md:z-auto md:max-w-none md:shrink-0 md:transform-none md:overflow-hidden md:border-l md:border-border md:shadow-rail",
          open ? "md:w-[400px]" : "md:w-12",
          resizing && "select-none",
        )}
      >
        {/* Drag the left edge to resize. Keyboard users get the arrow keys. */}
        {isDesktop && open ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize assistant panel"
            aria-valuenow={Math.round(panelWidth)}
            aria-valuemin={MIN_PANEL_WIDTH}
            aria-valuemax={MAX_PANEL_WIDTH}
            tabIndex={0}
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onKeyDown={onResizeKeyDown}
            className="group/resize absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize touch-none focus-visible:outline-none"
          >
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/resize:bg-border group-focus-visible/resize:bg-border" />
          </div>
        ) : null}

        <div
          aria-hidden={!open}
          inert={!open}
          className="flex h-full w-full flex-col bg-mail-assistant"
        >
          {open ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex h-11 shrink-0 items-center gap-2 px-2">
                <Image
                  src="/assitantlogo.png"
                  alt=""
                  width={36}
                  height={36}
                  className="ml-1 size-9 shrink-0 object-contain"
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {activeTitle || "New chat"}
                </span>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label="Collapse assistant"
                        onClick={() => setOpen(false)}
                        className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <ChevronsRight className="size-4" aria-hidden />
                      </button>
                    }
                  />
                  <TooltipContent>Collapse assistant</TooltipContent>
                </Tooltip>
              </div>
              {body}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          aria-hidden={open}
          inert={open}
          style={{ opacity: open ? 0 : 1 }}
          onClick={() => setOpen(true)}
          aria-label="Open assistant"
          title="Open assistant"
          className={cn(
            "absolute inset-0 flex cursor-pointer flex-col items-center gap-2 bg-mail-assistant py-3 text-muted-foreground transition-[opacity] duration-[160ms] ease-out hover:text-foreground",
            open && "pointer-events-none",
          )}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border">
            <Image
              src="/assitantlogo.png"
              alt=""
              width={28}
              height={28}
              className="size-6 shrink-0 object-contain"
            />
          </span>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border">
            <ChevronsLeft className="size-5 shrink-0" aria-hidden />
          </span>
        </button>
      </aside>
    </>
  );
}
