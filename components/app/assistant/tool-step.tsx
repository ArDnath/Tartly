"use client";

import type { ToolCallMessagePartStatus } from "@assistant-ui/react";
import {
  getToolName,
  type DynamicToolUIPart,
  type ToolUIPart,
} from "ai";
import { WrenchIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  ToolFallbackArgs,
  ToolFallbackContent,
  ToolFallbackError,
  ToolFallbackResult,
  ToolFallbackRoot,
  ToolFallbackTrigger,
} from "@/components/app/assistant-ui/elements/tool-fallback.aui";
import { ChainOfThoughtStep } from "@/components/ai-elements/chain-of-thought";

type ToolPart = ToolUIPart | DynamicToolUIPart;

/**
 * One tool call inside the chain of thought.
 *
 * The tool-call UI is assistant-ui's ToolFallback: a one-line "Used tool: name"
 * row that opens into the arguments and result, with the elapsed time ticking
 * while the call runs. It is composed from the presentational parts only — the
 * approval controls are left out because this app owns confirmations through
 * the approval dock above the composer, and the runtime-free parts keep the
 * component renderable without an assistant-ui runtime provider.
 */

/** Map an AI SDK tool part onto the assistant-ui tool-call status shape. */
function toAssistantStatus(part: ToolPart): ToolCallMessagePartStatus {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return { type: "running" };
    case "output-available":
    case "approval-responded":
      return { type: "complete" };
    case "output-error":
      return { type: "incomplete", reason: "error", error: part.errorText };
    case "output-denied":
      return { type: "incomplete", reason: "cancelled" };
    case "approval-requested":
      return { type: "requires-action", reason: "tool-calls" };
  }
}

function parametersText(part: ToolPart): string | undefined {
  if (part.input === undefined || part.input === null) return undefined;
  try {
    return JSON.stringify(part.input, null, 2);
  } catch {
    return String(part.input);
  }
}

export function ToolStep({
  part,
  showConnector = false,
  isStreaming = false,
  artifact,
}: {
  part: ToolPart;
  /** Continue the chain-of-thought rail below this step. */
  showConnector?: boolean;
  /**
   * Whether this step's turn is still streaming. A tool part can outlive the
   * turn that called it (an approval the model parked, a result the stream
   * never delivered), and its own state would keep the spinner going forever.
   * Gating on the live turn guarantees the animation stops the moment the
   * agent's response settles.
   */
  isStreaming?: boolean;
  /**
   * The visible result of this call, when it belongs on the chain rather than
   * in the transcript (search and research hits). Rendering it here ties the
   * outcome to the step that produced it; the raw JSON result is then dropped
   * so the same payload is not shown twice.
   */
  artifact?: ReactNode;
}) {
  const name = getToolName(part);
  const rawStatus = toAssistantStatus(part);
  const awaitingApproval = part.state === "approval-requested";
  // A tool part can outlive the turn that called it (an approval the model
  // parked, a result the stream never delivered). Its own state would keep the
  // spinner going forever, so the live turn — not just the part — decides
  // whether anything is still running.
  const running = isStreaming && rawStatus.type === "running";
  // Once the turn is over, a part that never produced output is settled, not
  // still working: render it complete rather than an endless spinner.
  const status =
    !isStreaming && rawStatus.type === "running"
      ? ({ type: "complete" } as const)
      : rawStatus;

  return (
    <ChainOfThoughtStep
      icon={WrenchIcon}
      status={running || awaitingApproval ? "active" : "complete"}
      showConnector={showConnector}
      label={
        <ToolFallbackRoot defaultOpen={awaitingApproval}>
          <ToolFallbackTrigger toolName={name} status={status} />
          <ToolFallbackContent>
            <ToolFallbackError status={status} />
            {awaitingApproval ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Waiting for your approval — confirm it just above the message
                box.
              </p>
            ) : null}
            <ToolFallbackArgs argsText={parametersText(part)} />
            {artifact ? null : <ToolFallbackResult result={part.output} />}
          </ToolFallbackContent>
        </ToolFallbackRoot>
      }
    >
      {artifact ? <div className="mt-1">{artifact}</div> : null}
    </ChainOfThoughtStep>
  );
}
