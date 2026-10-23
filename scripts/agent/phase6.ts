import "dotenv/config";

import { eq } from "drizzle-orm";

import type { AgentContext } from "../../lib/agent/context";
import type { AgentEvent } from "../../lib/agent/events";
import {
  MAX_AGENT_STEPS,
  runAgent,
  streamAgentTurn,
  type AgentTurnSummary,
} from "../../lib/agent/loop";
import { createToolRegistry } from "../../lib/agent/registry";
import {
  createDefaultToolRegistry,
  READ_TOOLS,
  WRITE_TOOLS,
} from "../../lib/agent/tools";
import { createArchiveEmailTool } from "../../lib/agent/tools/archive-email";
import { createCreateFollowupTool } from "../../lib/agent/tools/create-followup";
import { createDeleteEmailTool } from "../../lib/agent/tools/delete-email";
import { createExtractTasksTool } from "../../lib/agent/tools/extract-tasks";
import { createSearchEmailsTool } from "../../lib/agent/tools/search-emails";
import { db, pool } from "../../lib/db";
import {
  followupEnrollments,
  mailboxes,
  messages,
  threads,
  user,
} from "../../lib/db/schema";
import type {
  EmailDetail,
  EmailMailboxProvider,
  EmailSummary,
} from "../../lib/providers/email/types";
import { EmailService } from "../../lib/services/email-service";
import { FollowupService } from "../../lib/services/followup-service";
import { extractTasksHeuristic, TaskService } from "../../lib/services/task-service";
import { scriptedModel } from "./scripted-model";

/**
 * Phase 6 tests (brief Phase 10): advanced workflows, tasks and follow-ups.
 *
 *   - the task extractor is deterministic, capped and honest about due dates;
 *   - create_followup resolves the live Gmail thread to its mirror and reuses
 *     the existing enrollment engine, refusing cleanly when it is not synced;
 *   - a multi-step run stays bounded by MAX_AGENT_STEPS and terminates.
 */

let failures = 0;

function assert(condition: unknown, label: string): void {
  if (!condition) {
    failures += 1;
    throw new Error(`FAILED: ${label}`);
  }
  console.log(`  ok  ${label}`);
}

function section(name: string): void {
  console.log(`\n${name}:`);
}

function testCtx(
  userId: string,
  overrides: Partial<AgentContext["permissions"]> = {},
): AgentContext {
  return {
    userId,
    conversationId: "test-conversation",
    requestId: "test-request",
    permissions: {
      canRead: true,
      canWrite: true,
      canSend: true,
      requireConfirmationForSideEffects: true,
      allowAutonomousSideEffects: false,
      autonomy: "copilot",
      ...overrides,
    },
    locale: "en",
    timezone: "UTC",
    now: new Date(),
  };
}

// --------------------------------------------------------------------------
// Stub email provider (only the methods the tools touch)
// --------------------------------------------------------------------------

function messageDetail(overrides: Partial<EmailDetail> = {}): EmailDetail {
  return {
    id: "m1",
    threadId: "t1",
    from: { name: "Jane", email: "jane@acme.com" },
    to: [{ name: "Me", email: "me@example.com" }],
    subject: "Project plan",
    snippet: "Please review the plan",
    receivedAt: "2026-09-24T10:00:00.000Z",
    direction: "inbound",
    unread: true,
    starred: false,
    labels: [],
    hasAttachments: false,
    bodyText:
      "Hi,\n\nCan you please review the proposal by Friday?\nAlso send me the updated deck when you get a chance.\n\nThanks!",
    attachments: [],
    ...overrides,
  };
}

function stubProvider(detail: EmailDetail = messageDetail()): EmailMailboxProvider {
  const summary: EmailSummary = detail;
  return {
    kind: "gmail",
    isConnected: async () => true,
    searchMessages: async () => ({ messages: [summary] }),
    getMessage: async () => detail,
    getThread: async () => ({
      id: detail.threadId,
      subject: detail.subject,
      messages: [detail],
    }),
    listCorrespondents: async () => [],
    archiveMessage: async () => {},
    trashMessage: async () => {},
    untrashMessage: async () => {},
    deleteMessage: async () => {},
    markRead: async () => {},
    setStarred: async () => {},
    addLabel: async () => {},
    removeLabel: async () => {},
  };
}

// --------------------------------------------------------------------------
// Task extraction
// --------------------------------------------------------------------------

function runHeuristicTests(): void {
  section("task extraction is deterministic and honest");

  const text = [
    "Hi team,",
    "Can you please review the proposal by Friday?",
    "TODO: send the updated deck.",
    "The weather was nice.",
    "We should follow up next week.",
  ].join("\n");

  const tasks = extractTasksHeuristic(text);
  assert(tasks.length >= 3, "action sentences are extracted");
  assert(
    tasks.some((task) => /review the proposal/i.test(task.text)),
    "a polite request becomes a task",
  );
  assert(
    tasks.some((task) => task.dueHint === "Friday"),
    "a stated due hint is captured",
  );
  assert(
    tasks.every((task) => task.confidence > 0 && task.confidence <= 1),
    "every task carries a bounded confidence",
  );
  assert(
    !tasks.some((task) => /weather/.test(task.text)),
    "non-action sentences are ignored",
  );

  const capped = extractTasksHeuristic(
    Array.from({ length: 40 }, (_, i) => `Please do action item ${i}.`).join(" "),
  );
  assert(capped.length <= 10, "extraction is capped");
}

async function runExtractToolTests(): Promise<void> {
  section("extract_tasks reads a message and returns action items");

  const email = new EmailService(stubProvider());
  const tool = createExtractTasksTool({ email, tasks: new TaskService() });

  const output = (await tool.execute(testCtx("u1"), { messageId: "m1" })) as {
    count?: number;
    method?: string;
    tasks?: Array<{ text: string }>;
    contentTrust?: string;
  };
  assert(output.method === "heuristic", "offline extraction uses the heuristic");
  assert((output.count ?? 0) >= 2, "the tool returns the extracted tasks");
  assert(
    output.contentTrust === "untrusted-external-content",
    "derived tasks keep the untrusted stamp",
  );

  let needsTarget = false;
  try {
    await tool.execute(testCtx("u1"), {});
  } catch {
    needsTarget = true;
  }
  assert(needsTarget, "extract_tasks requires a message or thread");
}

async function runDeleteEmailPermanentTests(): Promise<void> {
  section("delete_email trashes by default and deletes forever when asked");

  const trashed: string[] = [];
  const deleted: string[] = [];
  const provider: EmailMailboxProvider = {
    ...stubProvider(),
    trashMessage: async ({ messageId }) => {
      trashed.push(messageId);
    },
    deleteMessage: async ({ messageId }) => {
      deleted.push(messageId);
    },
  };
  const tool = createDeleteEmailTool({ email: new EmailService(provider) });

  const normal = (await tool.execute(testCtx("u1"), { messageId: "m1" })) as {
    trashed?: boolean;
    permanent?: boolean;
  };
  assert(
    normal.trashed === true && normal.permanent === false,
    "delete_email defaults to the recoverable trash",
  );
  assert(
    trashed.includes("m1") && deleted.length === 0,
    "the default path never permanently deletes",
  );

  const forever = (await tool.execute(testCtx("u1"), {
    messageId: "m2",
    permanent: true,
  })) as { trashed?: boolean; permanent?: boolean };
  assert(
    forever.permanent === true && forever.trashed === false,
    "permanent: true reports a permanent delete",
  );
  assert(deleted.includes("m2"), "the permanent path reaches deleteMessage");
}

// --------------------------------------------------------------------------
// Follow-ups
// --------------------------------------------------------------------------
let seq = 0;
async function makeUserWithMirror(
  opts: { inboundFrom?: string } = {},
): Promise<{
  userId: string;
  mailboxId: string;
  gmailThreadId: string;
}> {
  seq += 1;
  const userId = `agent-phase6-${Date.now()}-${seq}`;
  const mailboxId = `mb_${userId}`;
  const gmailThreadId = `gt_${userId}`;
  await db.insert(user).values({ id: userId, name: "P6", email: `${userId}@example.com` });
  await db.insert(mailboxes).values({ id: mailboxId, userId, email: `${userId}@example.com` });
  await db.insert(threads).values({
    id: `th_${userId}`,
    mailboxId,
    userId,
    gmailThreadId,
    subject: "Project plan",
  });
  await db.insert(messages).values({
    id: `msg_${userId}`,
    threadId: `th_${userId}`,
    gmailMessageId: `gm_${userId}`,
    direction: "inbound",
    fromAddr: opts.inboundFrom ?? "jane@acme.com",
    sentAt: new Date(),
  });
  return { userId, mailboxId, gmailThreadId };
}

async function cleanup(users: string[]): Promise<void> {
  for (const id of users) await db.delete(user).where(eq(user.id, id));
}

async function runFollowupTests(): Promise<void> {
  section("create_followup reuses the mirror enrollment engine");

  assert(
    WRITE_TOOLS.some((tool) => tool.name === "create_followup") &&
      createCreateFollowupTool().risk === "WRITE",
    "create_followup is a WRITE tool",
  );
  assert(
    READ_TOOLS.some((tool) => tool.name === "extract_tasks"),
    "extract_tasks is registered as READ",
  );

  const service = new FollowupService();
  const a = await makeUserWithMirror();

  try {
    const enrolled = await service.createFollowup({
      userId: a.userId,
      gmailThreadId: a.gmailThreadId,
    });
    assert(enrolled.enrolled === true, "a synced thread can be enrolled");
    if (enrolled.enrolled) {
      assert(Boolean(enrolled.nextEvalAt), "the enrollment has a next evaluation time");
      const rows = await db
        .select()
        .from(followupEnrollments)
        .where(eq(followupEnrollments.userId, a.userId));
      assert(rows.length === 1 && rows[0]!.status === "active", "one active enrollment exists");
    }

    // Idempotent: enrolling twice reuses the active row.
    await service.createFollowup({ userId: a.userId, gmailThreadId: a.gmailThreadId });
    const after = await db
      .select()
      .from(followupEnrollments)
      .where(eq(followupEnrollments.userId, a.userId));
    assert(after.length === 1, "a second call does not create a duplicate enrollment");

    // Not synced.
    const unsynced = await service.createFollowup({
      userId: a.userId,
      gmailThreadId: "gt_does_not_exist",
    });
    assert(
      unsynced.enrolled === false && unsynced.reason === "not_synced",
      "an unsynced thread returns a clear not-synced result",
    );

    // Unreachable recipient.
    const b = await makeUserWithMirror({ inboundFrom: "noreply@service.com" });
    try {
      const unreachable = await service.createFollowup({
        userId: b.userId,
        gmailThreadId: b.gmailThreadId,
      });
      assert(
        unreachable.enrolled === false && unreachable.reason === "unreachable",
        "an automated sender is not enrolled",
      );
    } finally {
      await cleanup([b.userId]);
    }
  } finally {
    await cleanup([a.userId]);
  }
}

// --------------------------------------------------------------------------
// Bounded multi-step run
// --------------------------------------------------------------------------

async function runBoundedLoopTests(): Promise<void> {
  section("a multi-step run terminates at MAX_AGENT_STEPS");

  const email = new EmailService(stubProvider());
  const registry = createToolRegistry([
    createSearchEmailsTool({ email }),
    createArchiveEmailTool({ email }),
  ]);

  // The scripted model keeps calling tools forever; the loop must cap it.
  const model = scriptedModel([
    { toolCalls: [{ toolName: "search_emails", input: { query: "from:jane" } }] },
  ]);

  const events: AgentEvent[] = [];
  let toolExecutions = 0;
  const result = runAgent({
    ctx: testCtx("u-bounded"),
    model,
    system: "test",
    messages: [{ role: "user", content: "Find everything and keep going." }],
    registry,
    events: (event) => {
      events.push(event);
      if (event.type === "TOOL_STARTED") toolExecutions += 1;
    },
  });

  await result.text;

  const modelSteps = events.filter((event) => event.type === "MODEL_STEP_STARTED").length;
  assert(modelSteps > 1, "the run used more than one model step");
  assert(
    modelSteps <= MAX_AGENT_STEPS,
    `the run stopped at the step cap (${modelSteps} <= ${MAX_AGENT_STEPS})`,
  );
  assert(
    toolExecutions <= MAX_AGENT_STEPS,
    "tool executions are bounded by the step cap",
  );
}

// --------------------------------------------------------------------------
// Continuous turn (automatic continuation)
// --------------------------------------------------------------------------

async function runContinuationTests(): Promise<void> {
  section("a turn continues past the segment budget and merges into one stream");

  const email = new EmailService(stubProvider());
  const registry = createToolRegistry([
    createSearchEmailsTool({ email }),
  ]);

  // Two tool calls, then a final answer. With a one-step segment budget the
  // model needs at least three segments; the runtime must keep going without
  // the user re-prompting and present it as a single assistant turn.
  const model = scriptedModel([
    { toolCalls: [{ toolName: "search_emails", input: { query: "week" } }] },
    { toolCalls: [{ toolName: "search_emails", input: { query: "important" } }] },
    { text: "Here is your summary." },
  ]);

  const events: AgentEvent[] = [];
  let toolExecutions = 0;
  let summary: AgentTurnSummary | undefined;

  const stream = streamAgentTurn({
    ctx: testCtx("u-continuation"),
    model,
    system: "test",
    messages: [{ role: "user", content: "Summarise my week and keep going." }],
    registry,
    budget: {
      stepsPerSegment: 1,
      maxSegments: 8,
      maxTotalSteps: 50,
      maxTokensPerRun: 0,
    },
    events: (event) => {
      events.push(event);
      if (event.type === "TOOL_STARTED") toolExecutions += 1;
    },
    onFinish: (turnSummary) => {
      summary = turnSummary;
    },
  });

  const seen: string[] = [];
  let startChunks = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen.push(value.type);
      if (value.type === "start") startChunks += 1;
    }
  } finally {
    reader.releaseLock();
  }

  assert(summary?.status === "completed", "the continued turn completed");
  assert(
    (summary?.segments ?? 0) >= 3,
    `the turn spanned continuation segments (${summary?.segments})`,
  );
  assert(
    (summary?.steps ?? 0) > 1,
    "the turn used more than a single segment's budget",
  );
  assert(toolExecutions === 2, "both tool calls ran across segments");
  assert(startChunks === 1, "the merged stream exposes a single assistant start");
  assert(
    seen.includes("text-delta"),
    "the final answer was streamed in the same turn",
  );

  // The safety cap: an endless tool-caller must stop and say so, never loop.
  section("the safety cap stops an endless turn and says so");

  const endless = scriptedModel([
    { toolCalls: [{ toolName: "search_emails", input: { query: "loop" } }] },
  ]);
  let capped: AgentTurnSummary | undefined;
  let cappedText = "";

  const cappedStream = streamAgentTurn({
    ctx: testCtx("u-continuation-cap"),
    model: endless,
    system: "test",
    messages: [{ role: "user", content: "Never stop." }],
    registry,
    budget: {
      stepsPerSegment: 1,
      maxSegments: 2,
      maxTotalSteps: 2,
      maxTokensPerRun: 0,
    },
    onFinish: (turnSummary) => {
      capped = turnSummary;
    },
  });

  const cappedReader = cappedStream.getReader();
  try {
    for (;;) {
      const { done, value } = await cappedReader.read();
      if (done) break;
      if (value.type === "text-delta") cappedText += value.delta;
    }
  } finally {
    cappedReader.releaseLock();
  }

  assert(capped?.status === "limit_reached", "an endless turn is capped");
  assert(
    cappedText.includes("step limit"),
    "the capped turn tells the user how to continue",
  );
}

async function main(): Promise<void> {
  assert(createDefaultToolRegistry().has("extract_tasks"), "the default registry includes extract_tasks");
  runHeuristicTests();
  await runExtractToolTests();
  await runDeleteEmailPermanentTests();
  await runFollowupTests();
  await runBoundedLoopTests();
  await runContinuationTests();

  await pool.end().catch(() => {});

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll Phase 6 (workflows, tasks, follow-ups) checks passed.");
  process.exit(0);
}

main().catch((error) => {
  console.error("\nAgent Phase 6 test run failed:", error);
  process.exit(1);
});
