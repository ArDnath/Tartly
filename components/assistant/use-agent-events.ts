"use client";

import { useEffect, useRef, useState } from "react";

import type { AgentActionDto, MailThreadDto } from "@/lib/agent/realtime";

/**
 * Subscribe to the user's agent realtime stream.
 *
 * One EventSource per mounted consumer (in practice one pending confirmation
 * card). Losing the connection is non-fatal: `connected` turns false and the
 * card keeps its on-mount reconciliation path. The handler is kept in a ref so
 * a re-render never re-opens the connection.
 */
export function useAgentEvents(options: {
  onAction?: (action: AgentActionDto) => void;
  enabled?: boolean;
} = {}): { connected: boolean } {
  const handlerRef = useRef(options.onAction);
  const enabled = options.enabled ?? true;
  const [connected, setConnected] = useState(false);

  // Keep the latest handler without re-opening the connection. Updating in an
  // effect respects the render/commit boundary.
  useEffect(() => {
    handlerRef.current = options.onAction;
  }, [options.onAction]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    const source = new EventSource("/api/v1/agent/events");

    const onOpen = () => setConnected(true);
    const onError = () => setConnected(false);
    const onAction = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { action?: AgentActionDto };
        if (payload.action) handlerRef.current?.(payload.action);
      } catch {
        // ignore malformed frames
      }
    };

    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);
    source.addEventListener("action.updated", onAction as EventListener);

    return () => {
      source.removeEventListener("open", onOpen);
      source.removeEventListener("error", onError);
      source.removeEventListener("action.updated", onAction as EventListener);
      source.close();
      setConnected(false);
    };
  }, [enabled]);

  return { connected };
}

/**
 * Subscribe to new-mail notifications. The mirror only tells the client that
 * something changed; the mail client still loads live Gmail, so a stale or
 * empty mirror just means no event.
 */
export function useMailEvents(options: {
  onMail?: (thread: MailThreadDto) => void;
  /** Fired whenever the stream (re)connects — useful for recovering after a
   * dropped connection or a backend restart. */
  onConnect?: () => void;
  enabled?: boolean;
} = {}): { connected: boolean } {
  const handlerRef = useRef(options.onMail);
  const connectRef = useRef(options.onConnect);
  const enabled = options.enabled ?? true;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    handlerRef.current = options.onMail;
    connectRef.current = options.onConnect;
  }, [options.onMail, options.onConnect]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    const source = new EventSource("/api/v1/mail/events");
    const onOpen = () => {
      setConnected(true);
      connectRef.current?.();
    };
    const onError = () => setConnected(false);
    const onMail = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { thread?: MailThreadDto };
        if (payload.thread) handlerRef.current?.(payload.thread);
      } catch {
        // ignore malformed frames
      }
    };

    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);
    source.addEventListener("mail.updated", onMail as EventListener);

    return () => {
      source.removeEventListener("open", onOpen);
      source.removeEventListener("error", onError);
      source.removeEventListener("mail.updated", onMail as EventListener);
      source.close();
      setConnected(false);
    };
  }, [enabled]);

  return { connected };
}
