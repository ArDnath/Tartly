import "server-only";

/**
 * Deterministic, offline setup plan.
 *
 * Used when no AI provider is configured so the streaming chat remains fully
 * functional (SSE, persistence, markdown rendering) without an API key.
 */
export function buildFallbackSetupResponse({
  userName,
  workspaceName,
}: {
  userName: string | null;
  workspaceName: string;
}): string {
  const firstName = userName?.split(" ")[0] ?? "there";

  return `Welcome aboard, ${firstName} — **${workspaceName}** is ready to go.

Here's a path I'd suggest for your first session:

1. **Capture something real** — add a record or two so the workspace has shape. Empty tools are hard to evaluate.
2. **Import what you already have** — if you keep contacts or notes in a spreadsheet, bring them in rather than retyping them.
3. **Connect a tool** — wire up whichever app you already live in so updates flow in automatically.
4. **Invite one teammate** — a workspace is more useful once someone else can see it.
5. **Tell me your goal** — I can turn any of these into concrete steps.

What are you hoping to get done first?

_This is a local demo reply. Set \`OPENCODE_API_KEY\` to stream from a real model._`;
}

/**
 * Offline reply for the general chat page. Deterministic so the SSE plumbing,
 * persistence and rendering all work without an API key.
 */
export function buildFallbackChatResponse({
  userName,
  userMessage,
}: {
  userName: string | null;
  userMessage: string;
}): string {
  const firstName = userName?.split(" ")[0] ?? "there";
  const topic = userMessage.trim().replace(/\s+/g, " ").slice(0, 120);

  return `Got it, ${firstName} — you asked:

> ${topic}

I can help think this through. A few ways we could go:

1. **Break it down** — turn it into a small checklist of concrete steps.
2. **Compare options** — list trade-offs side by side.
3. **Draft it** — write a first version you can edit.

Tell me which direction you want, or say more about the context, and I'll go deeper.

_This is a local demo reply. Set \`OPENCODE_API_KEY\` to stream from a real model._`;
}
