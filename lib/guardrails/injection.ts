/**
 * Prompt-injection classifier. The inbound message is untrusted input: text
 * that tries to override the assistant's instructions must force a draft (or a
 * handoff), never an autonomous send.
 */

export type InjectionVerdict = {
  flagged: boolean;
  signals: string[];
};

const SIGNALS: Array<{ id: string; pattern: RegExp }> = [
  {
    id: "ignore_instructions",
    pattern: /ignore (all )?(previous|prior|above|earlier) instructions/i,
  },
  {
    id: "disregard_system",
    pattern: /disregard (the )?(system|previous|prior) (prompt|instructions)/i,
  },
  { id: "role_override", pattern: /you are now|act as (a|an)|pretend to be/i },
  {
    id: "prompt_exfiltration",
    pattern: /reveal (your )?(system prompt|instructions|configuration)/i,
  },
  {
    id: "tool_exfiltration",
    pattern: /send (the )?(email|money|payment)|transfer funds|wire \$/i,
  },
  {
    id: "developer_mode",
    pattern: /developer mode|jailbreak|DAN mode|no restrictions/i,
  },
];

export function classifyPromptInjection(text: string): InjectionVerdict {
  const signals = SIGNALS.filter((signal) => signal.pattern.test(text)).map(
    (signal) => signal.id,
  );
  return { flagged: signals.length > 0, signals };
}
