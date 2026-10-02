import "server-only";

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";

import { buildWorkspaceSetupKickoffMessageText } from "@/lib/ai/prompts";
import type { ChatThread } from "@/lib/ai/chat-types";
import { db } from "@/lib/db";
import { agentChatMessage, agentChatThread } from "@/lib/db/schema";
import type {
  WorkspaceSetupChatMessage,
  WorkspaceSetupChatOutcome,
} from "@/lib/onboarding/types";

export type { ChatThread };

const WORKSPACE_SETUP_THREAD_TITLE = "Workspace setup";

export function buildWorkspaceSetupThreadId(userId: string): string {
  return createHash("sha256")
    .update(`workspace-setup:${userId}`)
    .digest("hex")
    .slice(0, 32);
}

/* -------------------------------------------------------------------------- */
/*  General chat threads (the assistant chat)                                  */
/* -------------------------------------------------------------------------- */

type AgentChatThreadRow = typeof agentChatThread.$inferSelect;

function toChatThread(row: AgentChatThreadRow): ChatThread {
  return {
    id: row.id,
    title: row.title,
    isWorkspaceSetup: row.isWorkspaceSetup,
    kind: row.kind,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listChatThreads(
  userId: string,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<ChatThread[]> {
  const rows = await db
    .select()
    .from(agentChatThread)
    .where(
      includeArchived
        ? eq(agentChatThread.userId, userId)
        : and(eq(agentChatThread.userId, userId), isNull(agentChatThread.archivedAt)),
    )
    .orderBy(desc(agentChatThread.updatedAt));

  // The briefing conversation is retired: its old rows stay in the database
  // (historical messages still rehydrate) but are hidden from the thread list,
  // which is now only the user's own agent conversations.
  return rows.map(toChatThread).filter((thread) => thread.kind !== "briefing");
}

export async function createChatThread(
  userId: string,
  { title = null }: { title?: string | null } = {},
): Promise<ChatThread> {
  const inserted = await db
    .insert(agentChatThread)
    .values({ id: nanoid(), userId, title })
    .returning();

  return toChatThread(inserted[0]);
}

export async function findThreadForUser(
  userId: string,
  threadId: string,
): Promise<ChatThread | null> {
  const rows = await db
    .select()
    .from(agentChatThread)
    .where(
      and(eq(agentChatThread.id, threadId), eq(agentChatThread.userId, userId)),
    )
    .limit(1);

  return rows[0] ? toChatThread(rows[0]) : null;
}

export async function renameChatThread(
  userId: string,
  threadId: string,
  title: string,
): Promise<ChatThread | null> {
  const updated = await db
    .update(agentChatThread)
    .set({ title: title.trim().slice(0, 120) || null })
    .where(
      and(eq(agentChatThread.id, threadId), eq(agentChatThread.userId, userId)),
    )
    .returning();

  return updated[0] ? toChatThread(updated[0]) : null;
}

export async function setChatThreadArchived(
  userId: string,
  threadId: string,
  archived: boolean,
): Promise<ChatThread | null> {
  const updated = await db
    .update(agentChatThread)
    .set({ archivedAt: archived ? new Date() : null })
    .where(
      and(eq(agentChatThread.id, threadId), eq(agentChatThread.userId, userId)),
    )
    .returning();

  return updated[0] ? toChatThread(updated[0]) : null;
}

export async function deleteChatThread(
  userId: string,
  threadId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(agentChatThread)
    .where(
      and(eq(agentChatThread.id, threadId), eq(agentChatThread.userId, userId)),
    )
    .returning({ id: agentChatThread.id });

  return deleted.length > 0;
}

/** Deterministic first title so the sidebar is useful without a model call. */
export function deriveChatThreadTitle(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return "New chat";
  const words = normalized.split(" ").slice(0, 8).join(" ");
  return words.length > 60 ? `${words.slice(0, 57)}…` : words;
}

/**
 * Sets a thread's title from its first user message, if it has no title yet.
 * Returns the updated thread (or null when nothing changed).
 */
export async function ensureChatThreadTitle(
  userId: string,
  threadId: string,
  firstUserMessageText: string,
): Promise<ChatThread | null> {
  const thread = await findThreadForUser(userId, threadId);
  if (!thread || thread.title) return null;

  return renameChatThread(userId, threadId, deriveChatThreadTitle(firstUserMessageText));
}

export async function findThreadById(threadId: string) {
  const rows = await db
    .select()
    .from(agentChatThread)
    .where(eq(agentChatThread.id, threadId))
    .limit(1);

  return rows[0] ?? null;
}

export async function loadThreadMessages(
  threadId: string,
): Promise<WorkspaceSetupChatMessage[]> {
  const rows = await db
    .select()
    .from(agentChatMessage)
    .where(eq(agentChatMessage.threadId, threadId))
    .orderBy(asc(agentChatMessage.createdAt));

  return rows.map((row) => ({
    id: row.id,
    role: row.role as WorkspaceSetupChatMessage["role"],
    text: (row.parts ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(""),
    hidden: row.hidden,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function appendMessage({
  threadId,
  role,
  text,
  hidden = false,
}: {
  threadId: string;
  role: "user" | "assistant" | "system";
  text: string;
  hidden?: boolean;
}): Promise<WorkspaceSetupChatMessage> {
  const inserted = await db
    .insert(agentChatMessage)
    .values({
      id: nanoid(),
      threadId,
      role,
      parts: [{ type: "text", text }],
      hidden,
    })
    .returning();

  const row = inserted[0];

  await db
    .update(agentChatThread)
    .set({ updatedAt: new Date(), lastMessageAt: new Date() })
    .where(eq(agentChatThread.id, threadId));

  return {
    id: row.id,
    role: row.role as WorkspaceSetupChatMessage["role"],
    text,
    hidden: row.hidden,
    createdAt: row.createdAt.toISOString(),
  };
}

export type StartWorkspaceSetupChatResult = {
  outcome: WorkspaceSetupChatOutcome;
  thread: { id: string; title: string | null; createdAt: string } | null;
  messages: WorkspaceSetupChatMessage[];
};

/**
 * Starts (or resumes) the deterministic workspace-setup thread. Mirrors
 * Twenty's `WorkspaceSetupChatService.startWorkspaceSetupChat`: an existing
 * thread with conversation history is returned as `ALREADY_STARTED`; a fresh
 * thread gets a *hidden* kickoff prompt so the assistant has something to
 * respond to.
 */
export async function startWorkspaceSetupChat({
  userId,
  userName,
  userEmail,
  workspaceName,
  companyContext,
  personContext,
}: {
  userId: string;
  userName: string | null;
  userEmail: string;
  workspaceName: string;
  companyContext?: unknown;
  personContext?: unknown;
}): Promise<StartWorkspaceSetupChatResult> {
  const threadId = buildWorkspaceSetupThreadId(userId);
  let thread = await findThreadById(threadId);

  if (thread && thread.userId !== userId) {
    return { outcome: "UNAVAILABLE", thread: null, messages: [] };
  }

  if (thread) {
    const messages = await loadThreadMessages(threadId);
    const hasVisibleConversation = messages.some((message) => !message.hidden);

    return {
      outcome: hasVisibleConversation ? "ALREADY_STARTED" : "STARTED",
      thread: {
        id: thread.id,
        title: thread.title,
        createdAt: thread.createdAt.toISOString(),
      },
      messages,
    };
  }

  const insertedThread = await db
    .insert(agentChatThread)
    .values({
      id: threadId,
      userId,
      title: WORKSPACE_SETUP_THREAD_TITLE,
      isWorkspaceSetup: true,
    })
    .onConflictDoNothing()
    .returning();

  const resolvedThread = insertedThread[0] ?? (await findThreadById(threadId));
  if (!resolvedThread) {
    // The insert lost a delete race; the caller can retry rather than crash.
    return { outcome: "UNAVAILABLE", thread: null, messages: [] };
  }
  thread = resolvedThread;

  await appendMessage({
    threadId,
    role: "user",
    text: buildWorkspaceSetupKickoffMessageText({
      userName,
      userEmail,
      workspaceName,
      companyContext,
      personContext,
    }),
    hidden: true,
  });

  const messages = await loadThreadMessages(threadId);

  return {
    outcome: "STARTED",
    thread: {
      id: thread.id,
      title: thread.title,
      createdAt: thread.createdAt.toISOString(),
    },
    messages,
  };
}
