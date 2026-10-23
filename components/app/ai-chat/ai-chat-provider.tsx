"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  openPaywall,
  usePaywallStore,
} from "@/components/app/paywall/paywall-store";
import type { ChatMessage, ChatThread } from "@/lib/ai/chat-types";
import { readSseStream } from "@/lib/ai/sse-client";

type AiChatContextValue = {
  threads: ChatThread[];
  currentThreadId: string | null;
  currentThread: ChatThread | null;
  messages: ChatMessage[];
  queuedMessages: ChatMessage[];
  /** Signed-in user, used by the welcome preamble / overlay. */
  userName: string;
  userImage: string | null;
  draft: string;
  setDraft: (value: string) => void;
  isStreaming: boolean;
  isStartingThread: boolean;
  isLoadingMessages: boolean;
  error: string | null;
  clearError: () => void;
  selectThread: (threadId: string) => void;
  startNewChat: () => void;
  startWelcome: () => Promise<void>;
  send: (text: string) => Promise<void>;
  stop: () => void;
  removeQueuedMessage: (id: string) => void;
  renameThread: (threadId: string, title: string) => Promise<void>;
  setThreadArchived: (threadId: string, archived: boolean) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
};

const AiChatContext = createContext<AiChatContextValue | null>(null);

export function useAiChat(): AiChatContextValue {
  const context = useContext(AiChatContext);
  if (!context) {
    throw new Error("useAiChat must be used within <AiChatProvider>");
  }
  return context;
}

/**
 * Ambient chat context, or `null` when no provider is mounted. The assistant
 * modal uses it to reuse a screen-level provider when one exists, so the
 * welcome thread it streams is the same one the modal renders.
 */
export function useOptionalAiChat(): AiChatContextValue | null {
  return useContext(AiChatContext);
}

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function AiChatProvider({
  initialThreads = [],
  initialThreadId = null,
  userName,
  userImage,
  children,
}: {
  initialThreads?: ChatThread[];
  /** The thread to open first, e.g. from a history list. */
  initialThreadId?: string | null;
  userName: string;
  userImage: string | null;
  children: ReactNode;
}) {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialThreadId,
  );
  const [threads, setThreads] = useState<ChatThread[]>(initialThreads);
  const [messagesByThread, setMessagesByThread] = useState<
    Record<string, ChatMessage[]>
  >({});
  const [loadedThreadIds, setLoadedThreadIds] = useState<Record<string, true>>(
    {},
  );
  const [queuedMessages, setQueuedMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isStartingThread, setIsStartingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const isStreamingRef = useRef(false);
  const flushQueueRef = useRef<() => void>(() => {});
  const welcomeStartedRef = useRef(false);

  const currentThreadId = activeThreadId;
  const currentThread =
    threads.find((thread) => thread.id === currentThreadId) ?? null;
  const messages = useMemo(
    () => (currentThreadId ? (messagesByThread[currentThreadId] ?? []) : []),
    [currentThreadId, messagesByThread],
  );
  const isLoadingMessages = Boolean(
    currentThreadId && !loadedThreadIds[currentThreadId],
  );

  const refreshThreads = useCallback(async () => {
    try {
      const response = await fetch("/api/ai/threads", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { threads: ChatThread[] };
      setThreads(payload.threads);
    } catch (refreshError) {
      console.error("[ai-chat] failed to refresh threads", refreshError);
    }
  }, []);

  // Pull the thread list once on mount — the provider is screen-level, so the
  // list may not have been seeded server-side.
  useEffect(() => {
    let isActive = true;
    fetch("/api/ai/threads", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { threads: ChatThread[] };
      })
      .then((payload) => {
        if (isActive && payload) setThreads(payload.threads);
      })
      .catch((refreshError) => {
        console.error("[ai-chat] failed to refresh threads", refreshError);
      });

    return () => {
      isActive = false;
    };
  }, []);

  /** Select a thread (or clear it) in local state. */
  const navigateToThread = useCallback((threadId: string | null) => {
    setActiveThreadId(threadId);
  }, []);

  // Load messages for the active thread, once per thread.
  useEffect(() => {
    if (!currentThreadId || loadedThreadIds[currentThreadId]) return;

    let isActive = true;

    fetch(`/api/ai/threads/${currentThreadId}/messages`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load messages");
        return (await response.json()) as {
          thread: ChatThread;
          messages: ChatMessage[];
        };
      })
      .then((payload) => {
        if (!isActive) return;
        setMessagesByThread((current) => ({
          ...current,
          [currentThreadId]: payload.messages,
        }));
        setLoadedThreadIds((current) => ({
          ...current,
          [currentThreadId]: true,
        }));
        setThreads((current) =>
          current.map((thread) =>
            thread.id === payload.thread.id ? payload.thread : thread,
          ),
        );
      })
      .catch((loadError) => {
        if (!isActive) return;
        console.error("[ai-chat] failed to load messages", loadError);
        setError("Failed to load this conversation.");
      });

    return () => {
      isActive = false;
    };
  }, [currentThreadId, loadedThreadIds]);

  const appendMessage = useCallback((threadId: string, message: ChatMessage) => {
    setMessagesByThread((current) => ({
      ...current,
      [threadId]: [...(current[threadId] ?? []), message],
    }));
  }, []);

  const patchMessage = useCallback(
    (threadId: string, messageId: string, patch: Partial<ChatMessage>) => {
      setMessagesByThread((current) => ({
        ...current,
        [threadId]: (current[threadId] ?? []).map((message) =>
          message.id === messageId ? { ...message, ...patch } : message,
        ),
      }));
    },
    [],
  );

  const runStream = useCallback(
    async (
      threadId: string,
      options: { userText?: string; welcome?: boolean } = {},
    ) => {
      const controller = new AbortController();
      abortRef.current = controller;
      isStreamingRef.current = true;
      setIsStreaming(true);
      setError(null);

      const assistantMessageId = `assistant-${makeId()}`;
      appendMessage(threadId, {
        id: assistantMessageId,
        role: "assistant",
        text: "",
        createdAt: new Date().toISOString(),
        pending: true,
      });

      try {
        // The welcome reply streams from the workspace-setup endpoint (no user
        // message); every other turn streams from the thread messages endpoint.
        const response = options.welcome
          ? await fetch("/api/ai/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ threadId }),
              signal: controller.signal,
            })
          : await fetch(`/api/ai/threads/${threadId}/messages`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: options.userText }),
              signal: controller.signal,
            });

        // The server is the authority; if it blocks for payment, surface the
        // paywall instead of a generic failure.
        if (response.status === 402) {
          openPaywall("ai");
          void usePaywallStore.getState().refresh();
          setMessagesByThread((current) => ({
            ...current,
            [threadId]: (current[threadId] ?? []).filter(
              (message) => message.id !== assistantMessageId,
            ),
          }));
          return;
        }

        if (!response.ok || !response.body) {
          throw new Error("The assistant failed to respond.");
        }

        await readSseStream(response, (event, data) => {
          const payload = data as {
            delta?: string;
            messageId?: string;
            createdAt?: string;
            message?: string;
          };

          if (event === "delta" && payload.delta) {
            const delta = payload.delta;
            setMessagesByThread((current) => ({
              ...current,
              [threadId]: (current[threadId] ?? []).map((message) =>
                message.id === assistantMessageId
                  ? { ...message, text: message.text + delta }
                  : message,
              ),
            }));
          } else if (event === "done" && payload.messageId) {
            patchMessage(threadId, assistantMessageId, {
              id: payload.messageId,
              createdAt: payload.createdAt ?? new Date().toISOString(),
              pending: false,
            });
          } else if (event === "error") {
            setError(payload.message ?? "The assistant failed to respond.");
          }
        });
      } catch (streamError) {
        const isAbort =
          streamError instanceof DOMException &&
          streamError.name === "AbortError";

        if (!isAbort) {
          console.error("[ai-chat] stream failed", streamError);
          setError(
            streamError instanceof Error
              ? streamError.message
              : "The assistant failed to respond.",
          );
          setMessagesByThread((current) => ({
            ...current,
            [threadId]: (current[threadId] ?? []).filter(
              (message) => message.id !== assistantMessageId || message.text,
            ),
          }));
        }
      } finally {
        isStreamingRef.current = false;
        setIsStreaming(false);
        abortRef.current = null;
        void refreshThreads();
        flushQueueRef.current();
      }
    },
    [appendMessage, patchMessage, refreshThreads],
  );

  const sendInternal = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreamingRef.current) return;

      let threadId = currentThreadId;

      if (!threadId) {
        setIsStartingThread(true);
        try {
          const response = await fetch("/api/ai/threads", { method: "POST" });
          if (!response.ok) throw new Error("Failed to create chat");
          const payload = (await response.json()) as { thread: ChatThread };
          threadId = payload.thread.id;
          setThreads((current) => [payload.thread, ...current]);
          setMessagesByThread((current) => ({ ...current, [threadId!]: [] }));
          setLoadedThreadIds((current) => ({ ...current, [threadId!]: true }));
          navigateToThread(threadId);
        } catch (createError) {
          console.error("[ai-chat] failed to create thread", createError);
          setError("Failed to start a new chat.");
          return;
        } finally {
          setIsStartingThread(false);
        }
      }

      appendMessage(threadId, {
        id: `user-${makeId()}`,
        role: "user",
        text: trimmed,
        createdAt: new Date().toISOString(),
      });

      await runStream(threadId, { userText: trimmed });
    },
    [appendMessage, currentThreadId, navigateToThread, runStream],
  );

  /**
   * First-run welcome: ensures the deterministic workspace-setup thread exists,
   * selects it, and streams the assistant's suggested first-session path into
   * the normal chat surface. No-op after the first call.
   */
  const startWelcome = useCallback(async () => {
    if (welcomeStartedRef.current) return;
    welcomeStartedRef.current = true;

    // The welcome conversation is an AI response; free users never start it.
    const entitlement = usePaywallStore.getState().entitlement;
    if (entitlement && !entitlement.isSubscriber) return;

    try {
      const response = await fetch("/api/onboarding/workspace-setup-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error("Failed to start the welcome chat.");

      const payload = (await response.json()) as {
        outcome: "STARTED" | "ALREADY_STARTED" | "UNAVAILABLE";
        thread: { id: string } | null;
        messages: Array<{
          id: string;
          role: ChatMessage["role"];
          text: string;
          hidden: boolean;
          createdAt: string;
        }>;
      };

      const threadId = payload.thread?.id;
      if (!threadId || payload.outcome === "UNAVAILABLE") {
        setError("The assistant is unavailable right now.");
        return;
      }

      // Seed the thread before selecting it so the message loader doesn't
      // clobber the stream with an empty history.
      setMessagesByThread((current) => ({
        ...current,
        [threadId]: (payload.messages ?? [])
          .filter((message) => !message.hidden)
          .map((message) => ({
            id: message.id,
            role: message.role,
            text: message.text,
            createdAt: message.createdAt,
          })),
      }));
      setLoadedThreadIds((current) => ({ ...current, [threadId]: true }));

      await refreshThreads();

      if (currentThreadId !== threadId) {
        navigateToThread(threadId);
      }

      if (payload.outcome === "STARTED") {
        await runStream(threadId, { welcome: true });
      }
    } catch (welcomeError) {
      console.error("[ai-chat] failed to start welcome chat", welcomeError);
      setError("Failed to start the welcome chat.");
    }
  }, [currentThreadId, navigateToThread, refreshThreads, runStream]);

  const flushQueue = useCallback(async () => {
    const next = queuedMessages[0];
    if (!next) return;
    setQueuedMessages((current) => current.slice(1));
    await sendInternal(next.text);
  }, [queuedMessages, sendInternal]);

  useEffect(() => {
    flushQueueRef.current = () => {
      void flushQueue();
    };
  }, [flushQueue]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // AI is subscriber-only. Block before creating a thread or streaming so
      // the wall appears immediately, not after a failed request.
      const entitlement = usePaywallStore.getState().entitlement;
      if (entitlement && !entitlement.isSubscriber) {
        openPaywall("ai");
        return;
      }

      setDraft("");

      if (isStreamingRef.current) {
        setQueuedMessages((current) => [
          ...current,
          {
            id: `queued-${makeId()}`,
            role: "user",
            text: trimmed,
            createdAt: new Date().toISOString(),
            queued: true,
          },
        ]);
        return;
      }

      await sendInternal(trimmed);
    },
    [sendInternal],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const removeQueuedMessage = useCallback((id: string) => {
    setQueuedMessages((current) =>
      current.filter((message) => message.id !== id),
    );
  }, []);

  const selectThread = useCallback(
    (threadId: string) => {
      navigateToThread(threadId);
    },
    [navigateToThread],
  );

  const startNewChat = useCallback(() => {
    setDraft("");
    setError(null);
    navigateToThread(null);
  }, [navigateToThread]);

  const renameThread = useCallback(async (threadId: string, title: string) => {
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId ? { ...thread, title } : thread,
      ),
    );
    try {
      await fetch(`/api/ai/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
    } catch (renameError) {
      console.error("[ai-chat] failed to rename thread", renameError);
    }
  }, []);

  const setThreadArchived = useCallback(
    async (threadId: string, archived: boolean) => {
      setThreads((current) =>
        current.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                archivedAt: archived ? new Date().toISOString() : null,
              }
            : thread,
        ),
      );
      try {
        await fetch(`/api/ai/threads/${threadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived }),
        });
      } catch (archiveError) {
        console.error("[ai-chat] failed to archive thread", archiveError);
      }
      void refreshThreads();
    },
    [refreshThreads],
  );

  const deleteThread = useCallback(
    async (threadId: string) => {
      setThreads((current) =>
        current.filter((thread) => thread.id !== threadId),
      );
      try {
        await fetch(`/api/ai/threads/${threadId}`, { method: "DELETE" });
      } catch (deleteError) {
        console.error("[ai-chat] failed to delete thread", deleteError);
      }
      if (currentThreadId === threadId) {
        navigateToThread(null);
      }
      void refreshThreads();
    },
    [currentThreadId, navigateToThread, refreshThreads],
  );

  const value = useMemo<AiChatContextValue>(
    () => ({
      threads,
      currentThreadId,
      currentThread,
      messages,
      queuedMessages,
      userName,
      userImage,
      draft,
      setDraft,
      isStreaming,
      isStartingThread,
      isLoadingMessages,
      error,
      clearError: () => setError(null),
      selectThread,
      startNewChat,
      startWelcome,
      send,
      stop,
      removeQueuedMessage,
      renameThread,
      setThreadArchived,
      deleteThread,
    }),
    [
      threads,
      currentThreadId,
      currentThread,
      messages,
      queuedMessages,
      userName,
      userImage,
      draft,
      isStreaming,
      isStartingThread,
      isLoadingMessages,
      error,
      selectThread,
      startNewChat,
      startWelcome,
      send,
      stop,
      removeQueuedMessage,
      renameThread,
      setThreadArchived,
      deleteThread,
    ],
  );

  return (
    <AiChatContext.Provider value={value}>{children}</AiChatContext.Provider>
  );
}
