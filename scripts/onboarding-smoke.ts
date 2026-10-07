import "dotenv/config";
import { eq } from "drizzle-orm";

import {
  loadThreadMessages,
  startWorkspaceSetupChat,
  buildWorkspaceSetupThreadId,
} from "../lib/ai/chat-service";
import { buildFallbackSetupResponse } from "../lib/ai/fallback-response";
import { isAiProviderConfigured } from "../lib/ai/provider";
import { WORKSPACE_SETUP_SYSTEM_PROMPT } from "../lib/ai/prompts";
import { createAssistantReplyStream } from "../lib/ai/stream-reply";
import { db } from "../lib/db";
import { agentChatThread, onboardingState, user } from "../lib/db/schema";
import {
  advanceOnboarding,
  getOrCreateOnboardingState,
  goBackOnboarding,
} from "../lib/onboarding/server";

const TEST_USER_ID = `smoke-${Date.now()}`;

function assert(condition: unknown, label: string) {
  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
  console.log(`  ok  ${label}`);
}

async function main() {
  await db.insert(user).values({
    id: TEST_USER_ID,
    name: "Smoke Test",
    email: `${TEST_USER_ID}@example.com`,
  });

  try {
    console.log("state machine:");
    const initial = await getOrCreateOnboardingState(TEST_USER_ID);
    assert(initial.status === "PROFILE_CREATION", "starts at PROFILE_CREATION");
    assert(initial.previousStatus === null, "no previous step initially");

    const a = await advanceOnboarding({
      userId: TEST_USER_ID,
      stepHistoryEffect: "recordAsReversible",
      statusPatch: { jobTitle: "Founder", avatarUrl: "data:image/png;base64,AAA" },
    });
    assert(a.snapshot.status === "SYNC_EMAIL", "profile -> SYNC_EMAIL");
    assert(
      a.snapshot.previousStatus === "PROFILE_CREATION",
      "previous recorded as PROFILE_CREATION",
    );
    assert(a.snapshot.jobTitle === "Founder", "job title persisted");
    assert(a.snapshot.avatarUrl !== null, "avatar persisted off the auth user");

    const b = await advanceOnboarding({
      userId: TEST_USER_ID,
      stepHistoryEffect: "recordAsReversible",
    });
    assert(
      b.snapshot.status === "CALENDAR_SETUP",
      "sync -> CALENDAR_SETUP",
    );
    assert(
      b.snapshot.previousStatus === "SYNC_EMAIL",
      "previous advances to SYNC_EMAIL",
    );
    assert(b.justCompleted === false, "calendar step is not completion");

    const c = await advanceOnboarding({
      userId: TEST_USER_ID,
      stepHistoryEffect: "recordAsReversible",
    });
    assert(c.snapshot.status === "COMPLETED", "calendar -> COMPLETED");
    assert(c.justCompleted === true, "justCompleted is true");
    assert(c.snapshot.completedAt !== null, "completedAt is stamped");

    const back = await goBackOnboarding(TEST_USER_ID);
    assert(back.status === "CALENDAR_SETUP", "back returns to CALENDAR_SETUP");
    assert(back.direction === "backward", "back sets backward direction");

    const final = await advanceOnboarding({
      userId: TEST_USER_ID,
      stepHistoryEffect: "clearAfterIrreversibleStep",
    });
    assert(
      final.snapshot.status === "COMPLETED",
      "calendar -> COMPLETED (again)",
    );
    assert(final.justCompleted === true, "justCompleted is true again");
    assert(final.snapshot.previousStatus === null, "irreversible clears history");

    console.log("retired step:");
    // A row persisted on any removed step must read back as COMPLETED (so the
    // UI never renders the removed step) and keep moving forward, never loop
    // back to the first step.
    await db
      .update(onboardingState)
      .set({ status: "INVITE_TEAM", completedAt: null })
      .where(eq(onboardingState.userId, TEST_USER_ID));
    const normalized = await getOrCreateOnboardingState(TEST_USER_ID);
    assert(
      normalized.status === "COMPLETED",
      "retired INVITE_TEAM reads back as COMPLETED",
    );
    const fromRetired = await advanceOnboarding({
      userId: TEST_USER_ID,
      stepHistoryEffect: "recordAsReversible",
    });
    assert(
      fromRetired.snapshot.status === "COMPLETED",
      "retired step advances to COMPLETED (no loop to start)",
    );
    assert(fromRetired.justCompleted === true, "retired step reports completion");

    console.log("workspace setup chat:");
    const threadId = buildWorkspaceSetupThreadId(TEST_USER_ID);
    assert(
      threadId === buildWorkspaceSetupThreadId(TEST_USER_ID),
      "thread id is deterministic",
    );

    const started = await startWorkspaceSetupChat({
      userId: TEST_USER_ID,
      userName: "Smoke Test",
      userEmail: `${TEST_USER_ID}@example.com`,
      workspaceName: "Tartly",
    });
    assert(started.outcome === "STARTED", "first start returns STARTED");
    assert(started.thread?.id === threadId, "thread uses deterministic id");
    assert(started.messages.length === 1, "one hidden kickoff message");
    assert(started.messages[0].hidden === true, "kickoff message is hidden");

    const resumedBeforeReply = await startWorkspaceSetupChat({
      userId: TEST_USER_ID,
      userName: "Smoke Test",
      userEmail: `${TEST_USER_ID}@example.com`,
      workspaceName: "Tartly",
    });
    assert(
      resumedBeforeReply.outcome === "STARTED",
      "resume with only the hidden kickoff stays STARTED",
    );

    console.log("sse stream:");
    const stream = createAssistantReplyStream({
      threadId,
      systemPrompt: WORKSPACE_SETUP_SYSTEM_PROMPT,
      modelMessages: [{ role: "user", content: "hello" }],
      buildFallbackText: () =>
        buildFallbackSetupResponse({
          userName: "Smoke Test",
          workspaceName: "Tartly",
        }),
    });
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
    }

    const frames = raw
      .split("\n\n")
      .filter((frame) => frame.trim().length > 0)
      .map((frame) => {
        const eventLine = frame
          .split("\n")
          .find((line) => line.startsWith("event:"));
        const dataLine = frame
          .split("\n")
          .find((line) => line.startsWith("data:"));
        return {
          event: eventLine?.slice("event:".length).trim(),
          data: dataLine ? JSON.parse(dataLine.slice("data:".length).trim()) : null,
        };
      });

    const deltaFrames = frames.filter((frame) => frame.event === "delta");
    const doneFrame = frames.find((frame) => frame.event === "done");
    const streamedText = deltaFrames
      .map((frame) => frame.data.delta)
      .join("");

    assert(deltaFrames.length > 10, "stream emits many delta frames");
    assert(Boolean(doneFrame), "stream emits a done frame");
    assert(
      typeof doneFrame?.data.messageId === "string",
      "done frame carries a persisted message id",
    );
    assert(
      isAiProviderConfigured()
        ? streamedText.trim().length > 0
        : streamedText.includes("Welcome aboard"),
      "streamed text is the assistant reply",
    );
    assert(
      !frames.some((frame) => frame.event === "error"),
      "stream emits no error frames",
    );

    const afterStream = await loadThreadMessages(threadId);
    assert(
      afterStream.length === 2 && afterStream[1].role === "assistant",
      "assistant reply persisted after stream",
    );

    const resumedAfterReply = await startWorkspaceSetupChat({
      userId: TEST_USER_ID,
      userName: "Smoke Test",
      userEmail: `${TEST_USER_ID}@example.com`,
      workspaceName: "Tartly",
    });
    assert(
      resumedAfterReply.outcome === "ALREADY_STARTED",
      "second start after a visible reply returns ALREADY_STARTED",
    );

    const loaded = await loadThreadMessages(threadId);
    assert(loaded.length === 2, "thread messages persisted");

    console.log("fallback response:");
    const fallback = buildFallbackSetupResponse({
      userName: "Ada Lovelace",
      workspaceName: "Tartly",
    });
    assert(fallback.includes("Ada"), "fallback greets by first name");
    assert(fallback.length > 200, "fallback has real content");

    console.log("\nAll onboarding smoke checks passed.");
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
