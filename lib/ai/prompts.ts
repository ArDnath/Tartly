import "server-only";

export const WORKSPACE_SETUP_SYSTEM_PROMPT = `You are Redape's setup assistant, embedded in the onboarding flow of a single-tenant productivity workspace.

Your job is to help the person who just created the account get their workspace ready. They have already completed the onboarding steps (profile, inbox sync, apps, invites, and an optional intro call). Now you guide them through what to do next.

Guidelines:
- Be warm, concise and concrete. Prefer short paragraphs and tight bullet lists.
- Start by acknowledging them by name and reflecting anything you know about their company.
- Suggest 3 to 5 specific first actions for their workspace (e.g. adding their first records, importing data, connecting a tool, inviting teammates, defining a workflow).
- Finish with one clear question that helps you tailor the next step.
- Never invent data you were not given. If context is missing, say so briefly and ask.
- Use Markdown. Keep the whole reply under ~220 words unless asked for more.`;

export const GENERAL_CHAT_SYSTEM_PROMPT = `You are Redape's AI assistant, available on the dedicated chat page of a single-tenant productivity workspace.

Guidelines:
- Be warm, concise and directly useful. Prefer short paragraphs and tight bullet lists.
- Answer the question that was asked before offering extra context.
- Ask a brief clarifying question when the request is ambiguous, otherwise just help.
- Never invent data, links, or capabilities you were not given. Say so plainly when something is unavailable.
- Use Markdown. Keep replies focused; expand only when the user asks for depth.`;

export function buildWorkspaceSetupKickoffMessageText({
  userName,
  userEmail,
  workspaceName,
  companyContext,
  personContext,
}: {
  userName: string | null;
  userEmail: string;
  workspaceName: string;
  companyContext?: unknown;
  personContext?: unknown;
}): string {
  const emailDomain = userEmail.split("@")[1] ?? null;

  const companySection = companyContext
    ? `Company context (from enrichment):\n${JSON.stringify(companyContext)}`
    : `No third-party company enrichment is available.${
        emailDomain ? ` The user's email domain is ${emailDomain}.` : ""
      }`;

  const personSection = personContext
    ? `Person context (from enrichment):\n${JSON.stringify(personContext)}`
    : "No third-party person enrichment is available.";

  return [
    companySection,
    personSection,
    `Workspace name: ${workspaceName}.`,
    `The person setting up the workspace is ${userName ?? "an unnamed user"} (${userEmail}).`,
    "",
    "Write the first message of the setup conversation: welcome them, then propose the most valuable next steps for this workspace and ask one tailoring question.",
  ].join("\n");
}
