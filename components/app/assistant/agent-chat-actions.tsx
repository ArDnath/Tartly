"use client";

import { createContext, useContext } from "react";

/**
 * Actions a rendered tool card can trigger on the surrounding chat.
 *
 * This lives in its own module so `AgentChat` (which renders `AgentMessage`,
 * which renders the cards) and the cards can share it without a circular
 * import. The default is a no-op, so a card rendered outside a chat simply
 * does nothing.
 */
export interface AgentChatActions {
  /**
   * Continue the assistant turn after the user confirms or cancels a pending
   * action. The server persists the outcome as a hidden note and runs the agent
   * again, so the task finishes inside one conversation instead of waiting for
   * the user to type "continue".
   */
  resumeAfterAction?: (actionId: string) => void;
}

const AgentChatActionsContext = createContext<AgentChatActions>({});

export const AgentChatActionsProvider = AgentChatActionsContext.Provider;

export function useAgentChatActions(): AgentChatActions {
  return useContext(AgentChatActionsContext);
}
