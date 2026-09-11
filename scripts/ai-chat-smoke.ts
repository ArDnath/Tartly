import "dotenv/config";
import { eq } from "drizzle-orm";

import {
  appendMessage,
  createChatThread,
  deleteChatThread,
  ensureChatThreadTitle,
  listChatThreads,
  loadThreadMessages,
  renameChatThread,
  setChatThreadArchived,
} from "../lib/ai/chat-service";
import { buildFallbackChatResponse } from "../lib/ai/fallback-response";
import { GENERAL_CHAT_SYSTEM_PROMPT } from "../lib/ai/prompts";
import { createAssistantReplyStream } from "../lib/ai/stream-reply";
import { db } from "../lib/db";
import { agentChatThread, user } from "../lib/db/schema";

const TEST_USER_ID = `ai-chat-smoke-${Date.now()}`;

function assert(condition: unknown, label: string) {
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`  ok  ${label}`);
}

async function consumeStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }
  return raw
    .split("\n\n")
    .filter((frame) => frame.trim())
    .map((frame) => {
      const event = frame
        .split("\n")
        .find((line) => line.startsWith("event:"))
        ?.slice("event:".length)
        .trim();
      const dataLine = frame
        .split("\n")
        .find((line) => line.startsWith("data:"));
      return { event, data: dataLine ? JSON.parse(dataLine.slice(5).trim()) : null };
    });
}

async function main() {
  await db.insert(user).values({
    id: TEST_USER_ID,
    name: "Chat Smoke",
    email: `${TEST_USER_ID}@example.com`,
  });

  try {
    console.log("threads:");
    const created = await createChatThread(TEST_USER_ID);
    assert(created.title === null, "new thread has no title");

    let threadList = await listChatThreads(TEST_USER_ID);
    assert(threadList.length === 1, "thread appears in list");

    const userText = "Help me plan my week around three priorities";
    await appendMessage({ threadId: created.id, role: "user", text: userText });
    const titled = await ensureChatThreadTitle(
      TEST_USER_ID,
      created.id,
      userText,
    );
    assert(titled?.title === userText, "title derived from first message");

    const renamed = await renameChatThread(TEST_USER_ID, created.id, "Weekly plan");
    assert(renamed?.title === "Weekly plan", "thread renamed");
    assert(
      (await renameChatThread(TEST_USER_ID, created.id, "Ignored"))?.title ===
        "Ignored",
      "rename is idempotent",
    );

    console.log("streaming:");
    const history = await loadThreadMessages(created.id);
    const stream = createAssistantReplyStream({
      threadId: created.id,
      systemPrompt: GENERAL_CHAT_SYSTEM_PROMPT,
      modelMessages: history.map((m) => ({
        role: m.role === "system" ? "user" : m.role,
        content: m.text,
      })),
      buildFallbackText: () =>
        buildFallbackChatResponse({ userName: "Chat Smoke", userMessage: userText }),
    });
    const frames = await consumeStream(stream);
    const deltas = frames.filter((frame) => frame.event === "delta");
    const doneFrame = frames.find((frame) => frame.event === "done");

    assert(deltas.length > 10, "stream emits delta frames");
    assert(Boolean(doneFrame?.data?.messageId), "stream emits done with id");
    assert(
      !frames.some((frame) => frame.event === "error"),
      "stream emits no error frames",
    );

    const after = await loadThreadMessages(created.id);
    assert(
      after.length === 2 && after[1].role === "assistant",
      "assistant reply persisted",
    );

    console.log("archive / delete:");
    await setChatThreadArchived(TEST_USER_ID, created.id, true);
    threadList = await listChatThreads(TEST_USER_ID);
    assert(threadList.length === 0, "archived thread hidden by default");
    threadList = await listChatThreads(TEST_USER_ID, { includeArchived: true });
    assert(threadList.length === 1, "archived thread visible when requested");

    await setChatThreadArchived(TEST_USER_ID, created.id, false);
    assert(
      (await listChatThreads(TEST_USER_ID)).length === 1,
      "unarchive restores the thread",
    );

    const deleted = await deleteChatThread(TEST_USER_ID, created.id);
    assert(deleted, "delete returns true");
    assert(
      (await listChatThreads(TEST_USER_ID)).length === 0,
      "deleted thread is gone",
    );

    const foreign = await createChatThread(TEST_USER_ID);
    assert(
      (await listChatThreads("someone-else")).length === 0,
      "threads are user-scoped",
    );
    await deleteChatThread(TEST_USER_ID, foreign.id);

    console.log("\nAll AI chat smoke checks passed.");
  } finally {
    await db.delete(agentChatThread).where(eq(agentChatThread.userId, TEST_USER_ID));
    await db.delete(user).where(eq(user.id, TEST_USER_ID));
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
