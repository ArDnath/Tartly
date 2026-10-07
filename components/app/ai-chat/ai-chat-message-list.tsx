"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { useAiChat } from "@/components/app/ai-chat/ai-chat-provider";
import { AiChatMessage } from "@/components/app/ai-chat/ai-chat-message";

// The preamble carries its own Motion-driven intro animation. Only the
// workspace-setup thread renders it, so it is loaded on demand rather than
// shipping Motion with every mail screen.
const WorkspaceSetupChatPreamble = dynamic(
  () =>
    import("@/components/app/onboarding/chat/workspace-setup-chat-preamble").then(
      (module) => module.WorkspaceSetupChatPreamble,
    ),
  { ssr: false },
);

export const AiChatMessageList = () => {
  const {
    messages,
    isStreaming,
    isLoadingMessages,
    error,
    currentThread,
    userName,
    userImage,
  } = useAiChat();

  const lastMessageId = messages[messages.length - 1]?.id;

  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="mx-auto w-full max-w-[768px] gap-6 p-4">
        {/* The welcome thread keeps its intro line, and it doubles as the
            overlay title's flight target. */}
        {currentThread?.isWorkspaceSetup ? (
          <WorkspaceSetupChatPreamble
            isWelcomeVisible={false}
            isWelcomeLeaving={false}
            userName={userName}
            userImage={userImage}
          />
        ) : null}

        {isLoadingMessages ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading conversation…
          </div>
        ) : null}

        {messages.map((message) => (
          <AiChatMessage
            key={message.id}
            message={message}
            isStreaming={
              isStreaming &&
              message.id === lastMessageId &&
              message.role === "assistant"
            }
          />
        ))}

        {error ? (
          <p className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="size-3.5 shrink-0" />
            {error}
          </p>
        ) : null}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
};
