/**
 * Internal agent event model.
 *
 * This is deliberately *not* the wire format. The wire is the AI SDK's UI
 * message stream (which the client consumes via `useChat`); these events are
 * the observability contract, so logs, the run trace and future consumers
 * (metrics, evals, an SSE audit feed) all speak one stable vocabulary instead
 * of provider-specific stream parts.
 *
 * Event payloads never carry email bodies, tokens or model output.
 */

export type AgentEvent =
  | { type: "AGENT_STARTED"; requestId: string; runId: string; conversationId: string }
  | { type: "MODEL_STEP_STARTED"; step: number }
  | { type: "MODEL_STEP_FINISHED"; step: number; ms: number; finishReason?: string }
  | { type: "TOOL_STARTED"; step: number; toolName: string; risk: string; toolCallId: string }
  | {
      type: "TOOL_RETRY";
      step: number;
      toolName: string;
      toolCallId: string;
      attempt: number;
    }
  | { type: "TOOL_SUCCEEDED"; step: number; toolName: string; toolCallId: string; ms: number }
  | {
      type: "TOOL_FAILED";
      step: number;
      toolName: string;
      toolCallId: string;
      ms: number;
      code: string;
    }
  | { type: "TOOL_DENIED"; step: number; toolName: string; toolCallId: string; reason: string }
  | {
      type: "CONFIRMATION_REQUIRED";
      step: number;
      toolName: string;
      toolCallId: string;
      actionId: string;
    }
  | { type: "ACTION_CONFIRMED"; actionId: string; toolName: string; userId: string }
  | { type: "ACTION_SUCCEEDED"; actionId: string; toolName: string; ms: number }
  | { type: "ACTION_FAILED"; actionId: string; toolName: string; code: string }
  | { type: "ACTION_CANCELLED"; actionId: string; toolName: string }
  | { type: "AGENT_FINISHED"; runId: string; status: string; steps: number; ms: number }
  | { type: "AGENT_ERROR"; runId: string; code: string };

export type AgentEventSink = (event: AgentEvent) => void;

export const noopAgentEvents: AgentEventSink = () => {};

/**
 * Structured, redacted console sink. One line per event keeps agent runs
 * grep-able in local dev and Vercel logs without a logging dependency.
 */
export function createLoggingEventSink(scope = "agent"): AgentEventSink {
  return (event) => {
    console.log(`[${scope}] ${event.type}`, JSON.stringify(event));
  };
}
