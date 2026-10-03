import "server-only";

import { buildAgentSystemPrompt } from "@/lib/agent/prompts";
import { createToolRegistry, type ToolRegistry } from "@/lib/agent/registry";
import { READ_TOOLS } from "@/lib/agent/tools";
import { deliverComposerDraftTool } from "@/lib/agent/tools/deliver-composer-draft";

/**
 * "Write with AI" in the composer, driven by the **same agent runtime** as the
 * assistant space (`/assistant`, the mail side panel): the same model role, the
 * same `AgentContext`/permissions, the same read tools, the same system prompt
 * and the same streamed UI messages, so the composer can render the identical
 * thinking/tool-step animation with `AgentMessage`.
 *
 * The only difference is the terminal step: instead of sending or saving to
 * Gmail, the agent calls `deliver_composer_draft`, whose *tool result* is the
 * finished draft. The composer reads it off the stream, fills the form, and the
 * thinking UI is replaced by the draft. Nothing is ever sent from here.
 */

export interface ComposeAgentInput {
  instruction: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
}

/**
 * Read-only by construction: search and read tools plus the terminal deliver
 * tool. No `create_draft`/`send_email`, so this path can find who the mail is
 * for but can never write to Gmail or send.
 */
export function createComposeAgentRegistry(): ToolRegistry {
  return createToolRegistry([...READ_TOOLS, deliverComposerDraftTool]);
}

const COMPOSE_SYSTEM_ADDENDUM = `## Compose mode
The user is writing an email in the message composer. Your job is to fill it in for them.

- Work out who the message is for. If the user names a person (for example "Sattamjit Banik"):
  1. Call search_contacts with their name. It matches on name and address; if the full name finds nothing, retry with just the surname or first name, and try a likely spelling if the name looks mistyped.
  2. If no contact matches, call search_emails with the name (again, retry with the surname alone), then read the sender/recipient addresses on the matching messages with get_email or get_thread and use the address that belongs to that person.
  3. Never invent an address. If nothing matches, leave \`to\` empty and say so in your reply; the user can fill it in.
- Put the found address in \`to\`. Use \`cc\` or \`bcc\` only when the user explicitly asks to copy or blind-copy someone.
- Write a clear subject and a complete, ready-to-send body. Match the tone of the user's instruction and any existing draft.
- When the draft is ready, call \`deliver_composer_draft\` exactly once with the final fields.
- Never send. The user reviews the draft and approves it themselves.`;

/** The agent system prompt plus the composer's terminal-action contract. */
export function buildComposeAgentSystemPrompt(input: {
  now: Date;
  timezone: string;
}): string {
  return `${buildAgentSystemPrompt(input)}\n\n${COMPOSE_SYSTEM_ADDENDUM}`;
}

/** The single user turn: the instruction, plus whatever the composer holds. */
export function buildComposeAgentPrompt(input: ComposeAgentInput): string {
  const context = [
    input.to.length ? `Current To: ${input.to.join(", ")}` : "",
    input.cc.length ? `Current Cc: ${input.cc.join(", ")}` : "",
    input.bcc.length ? `Current Bcc: ${input.bcc.join(", ")}` : "",
    input.subject.trim() ? `Current subject: ${input.subject.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    context,
    `<instruction>\n${
      input.instruction.trim() || "Write a fitting email based on the current draft."
    }\n</instruction>`,
    input.body.trim()
      ? `<existing_draft>\n${input.body.trim()}\n</existing_draft>`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
