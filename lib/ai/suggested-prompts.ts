import type { SuggestedPrompt } from "@/lib/ai/chat-types";

/**
 * Starter prompts shown on an empty chat. Port of Twenty's
 * `getAiChatSuggestedPrompts` default set, adapted for a generic workspace.
 */
export const AI_CHAT_SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  {
    id: "summarize",
    label: "Summarize something",
    prompt: "Summarize the key points of the notes I paste below.\n\n",
  },
  {
    id: "brainstorm",
    label: "Brainstorm ideas",
    prompt: "Brainstorm 10 ideas for improving how my team works.\n\n",
  },
  {
    id: "plan",
    label: "Make a plan",
    prompt: "Help me turn this goal into a step-by-step plan:\n\n",
  },
  {
    id: "draft",
    label: "Draft a message",
    prompt: "Draft a short, friendly message to a teammate about:\n\n",
  },
];
