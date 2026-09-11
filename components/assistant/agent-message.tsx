"use client";

import {
  getToolName,
  isToolUIPart,
  type DynamicToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai";
import { BrainIcon, ShieldAlertIcon } from "lucide-react";
import { memo } from "react";

import { ContactCard } from "@/components/assistant/cards/contact-card";
import { EmailActionResultCard } from "@/components/assistant/cards/email-action-result-card";
import { EmailDraftCard } from "@/components/assistant/cards/email-draft-card";
import { EmailPreviewCard } from "@/components/assistant/cards/email-preview-card";
import { EmailSearchResults } from "@/components/assistant/cards/email-search-results";
import { EmailThreadCard } from "@/components/assistant/cards/email-thread-card";
import { MailboxActionCard } from "@/components/assistant/cards/mailbox-action-card";
import { ResearchCard } from "@/components/assistant/cards/research-card";
import { TaskCard } from "@/components/assistant/cards/task-card";
import { asRecord, asString } from "@/components/assistant/cards/shared";
import { ToolStep } from "@/components/assistant/tool-step";
import { ChainOfThoughtStep } from "@/components/ai-elements/chain-of-thought";
import { ThinkingReasoning } from "@/components/ai-elements/thinking-reasoning";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";

type ToolPart = ToolUIPart | DynamicToolUIPart;
type MessagePart = UIMessage["parts"][number];
type ReasoningPart = Extract<MessagePart, { type: "reasoning" }>;
type TracePart = ReasoningPart | ToolPart;

/** Stable empty set so messages without live approvals keep their memo. */
const EMPTY_APPROVAL_IDS: ReadonlySet<string> = new Set();

/**
 * The model's work as one animated chain of thought: reasoning prose plus each
 * tool call, in order. The section shimmers while the turn is live and folds
 * into a "Thought for Ns" summary once it settles. Tool calls render through
 * assistant-ui's ToolFallback; their arguments stay collapsed. The transcript
 * below this panel carries only what the user asked for — prose and artifact
 * cards — never raw tool JSON.
 *
 * Reasoning and tool calls are both nodes on one continuous rail: every node
 * but the last keeps the connector line, so the work reads as a single chain.
 */
function TracePanel({
  parts,
  isStreaming,
}: {
  parts: TracePart[];
  isStreaming: boolean;
}) {
  return (
    <ThinkingReasoning isStreaming={isStreaming}>
      {parts.map((part, index) => {
        const isLast = index === parts.length - 1;

        if (part.type === "reasoning") {
          return (
            <ChainOfThoughtStep
              key={`reasoning:${index}`}
              icon={BrainIcon}
              status="complete"
              showConnector={!isLast}
              label={
                <MessageResponse
                  className="text-muted-foreground"
                  isAnimating={isStreaming && isLast}
                >
                  {part.text}
                </MessageResponse>
              }
            />
          );
        }

        return (
          <ToolStep
            key={`tool:${index}`}
            part={part}
            showConnector={!isLast}
          />
        );
      })}
    </ThinkingReasoning>
  );
}

/** A pending side effect: pointing at the approval dock above the composer. */
function PendingApprovalNote() {
  return (
    <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
      <ShieldAlertIcon className="size-3.5 shrink-0" aria-hidden />
      Waiting for your approval — confirm it just above the message box.
    </p>
  );
}

/**
 * The visible artifact a tool produced, if any. Tool *narration* always lives
 * in the chain of thought; this only returns the thing the user actually wants
 * to see (a draft, search results, a sent-mail receipt).
 */
function toolArtifact(
  toolName: string,
  part: ToolPart,
  liveApprovalIds: ReadonlySet<string>,
) {
  if (part.state !== "output-available") return null;

  switch (toolName) {
    case "search_emails":
      return <EmailSearchResults output={part.output} />;
    case "get_email":
      return <EmailPreviewCard output={part.output} />;
    case "get_thread":
      return <EmailThreadCard output={part.output} />;
    case "search_contacts":
    case "get_contact":
      return <ContactCard output={part.output} />;
    case "search_web":
    case "open_web_page":
    case "research_person":
    case "research_company":
      return <ResearchCard output={part.output} />;
    case "extract_tasks":
      return <TaskCard output={part.output} />;
    case "create_draft":
    case "update_draft":
      return <EmailDraftCard toolName={toolName} output={part.output} />;
    case "archive_email":
    case "mark_email_read":
    case "add_label":
    case "remove_label":
      return <MailboxActionCard toolName={toolName} output={part.output} />;
    case "send_email":
    case "reply_to_email":
    case "forward_email":
    case "delete_email":
    case "schedule_email": {
      // Copilot leaves this pending; the interactive card is docked above the
      // composer. Autopilot has already executed it, so show the receipt.
      if (asString(asRecord(part.output)?.status) === "confirmation_required") {
        // Only point at the dock when it is actually carrying this approval.
        // A stored approval from an earlier session is not replayed there, so
        // the transcript stays quiet instead of advertising a tray that is not
        // on screen.
        const pendingActionId = asString(asRecord(part.output)?.pendingActionId);
        return pendingActionId && liveApprovalIds.has(pendingActionId) ? (
          <PendingApprovalNote />
        ) : null;
      }
      return (
        <EmailActionResultCard
          toolName={toolName}
          input={part.input}
          output={part.output}
        />
      );
    }
    default:
      return null;
  }
}

/**
 * Renders one stored/streaming UI message.
 *
 * Reasoning and tool parts become a single animated `<ThinkingReasoning>`
 * section; tool calls render through assistant-ui's ToolFallback with
 * collapsed, readable arguments and results. The body below carries prose and
 * artifact cards only. Unknown part types are ignored rather than crashing the
 * transcript.
 */
export const AgentMessage = memo(function AgentMessage({
  message,
  isStreaming = false,
  liveApprovalIds = EMPTY_APPROVAL_IDS,
}: {
  message: UIMessage;
  /** True while this message's turn is still streaming from the server. */
  isStreaming?: boolean;
  /**
   * Approval ids currently docked above the composer. Only those get the
   * "waiting for approval" cue; stored approvals from a loaded conversation are
   * not docked and stay silent.
   */
  liveApprovalIds?: ReadonlySet<string>;
}) {
  const traceParts = message.parts.filter(
    (part): part is TracePart => part.type === "reasoning" || isToolUIPart(part),
  );

  return (
    <Message from={message.role}>
      <MessageContent>
        {traceParts.length > 0 ? (
          <TracePanel parts={traceParts} isStreaming={isStreaming} />
        ) : null}

        {message.parts.map((part, index) => {
          const key = `${message.id}:${index}`;

          if (part.type === "text") {
            return <MessageResponse key={key}>{part.text}</MessageResponse>;
          }

          if (isToolUIPart(part)) {
            const artifact = toolArtifact(
              getToolName(part),
              part,
              liveApprovalIds,
            );
            return artifact ? <div key={key}>{artifact}</div> : null;
          }

          return null;
        })}
      </MessageContent>
    </Message>
  );
});
