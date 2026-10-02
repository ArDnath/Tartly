import { MockLanguageModelV4, simulateReadableStream } from "ai/test";

/**
 * A deterministic scripted language model for integration tests and evals.
 *
 * `streamText` drives the model/tool cycle; this mock lets a test decide, turn
 * by turn, whether the "model" calls a tool or answers. That exercises the real
 * loop — permission decisions, validation, confirmation deferral, step cap —
 * without a network or an API key. `MockLanguageModelV4` is the provider-spec
 * mock shipped by the AI SDK.
 */

export interface ScriptedToolCall {
  toolName: string;
  input: unknown;
}

export interface ScriptedTurn {
  text?: string;
  toolCalls?: ScriptedToolCall[];
}

/** Provider-spec v4 usage; the loop only reads the totals. */
const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

export interface ScriptedModelOptions {
  /**
   * Called before each turn with the names of the tools the model was offered.
   * Used to assert progressive tool disclosure actually shrinks the request.
   */
  onStep?: (offeredToolNames: string[]) => void;
}

export function scriptedModel(
  turns: ScriptedTurn[],
  options: ScriptedModelOptions = {},
) {
  if (turns.length === 0) throw new Error("scriptedModel needs at least one turn");
  let index = 0;

  return new MockLanguageModelV4({
    modelId: "scripted-eval",
    doStream: async (params: { tools?: Array<{ name?: string }> }) => {
      // After the script runs out, repeat the final turn so a bounded-loop test
      // actually reaches the cap instead of stopping early.
      const turn = turns[Math.min(index, turns.length - 1)]!;
      index += 1;
      options.onStep?.(
        (params.tools ?? [])
          .map((tool) => tool.name ?? "")
          .filter((name) => name.length > 0),
      );

      const chunks: Array<Record<string, unknown>> = [
        { type: "stream-start", warnings: [] },
      ];
      if (turn.text) {
        chunks.push(
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: turn.text },
          { type: "text-end", id: "t" },
        );
      }
      let callIndex = 0;
      for (const call of turn.toolCalls ?? []) {
        chunks.push({
          type: "tool-call",
          toolCallId: `tc_${index}_${callIndex++}`,
          toolName: call.toolName,
          input: JSON.stringify(call.input ?? {}),
        });
      }
      chunks.push({
        type: "finish",
        usage: USAGE,
        finishReason: {
          unified: turn.toolCalls?.length ? "tool-calls" : "stop",
          raw: undefined,
        },
      });

      return { stream: simulateReadableStream({ chunks }) } as never;
    },
  });
}
