import "dotenv/config";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { buildDraftContext, buildDraftContextPrompt } from "../../lib/ai/features/draft-context";
import { db, pool } from "../../lib/db";
import {
  assistantSettings,
  commitments,
  contacts,
  drafts,
  messages,
  threads,
} from "../../lib/db/schema";
import {
  buildCommitmentNudgeBody,
  deleteCommitmentsForUser,
  enqueueDueCommitments,
  extractCommitmentsForThread,
  listOpenCommitments,
  parseDueAt,
} from "../../lib/commitments/service";
import { buildBriefing, daypartForHour } from "../../lib/briefing/service";
import { buildCatchUp, buildCatchUpHeadline } from "../../lib/briefing/catchup";
import { buildInboundEmailGraph, nextNode } from "../../lib/engine/flow";
import { updateMemoryStep } from "../../lib/engine/steps/update-memory";
import { ensureMailbox } from "../../lib/email-operator/mailbox";
import { bucketFor, matchesView, normalizeView } from "../../lib/inbox/service";
import {
  resolveAutonomy,
  setMailboxAutonomy,
  setThreadAutonomy,
} from "../../lib/settings/autonomy";
import {
  assert,
  createTestUser,
  deleteTestUser,
  getFailureCount,
  makeTestUserId,
  section,
} from "./harness";

async function seedThread({
  userId,
  mailboxId,
  gmailThreadId,
  from,
  subject = "Phase 8 thread",
}: {
  userId: string;
  mailboxId: string;
  gmailThreadId: string;
  from: string;
  subject?: string;
}): Promise<string> {
  const threadId = nanoid();
  await db.insert(threads).values({
    id: threadId,
    mailboxId,
    userId,
    gmailThreadId,
    subject,
    lastMessageAt: new Date(),
  });
  await db.insert(messages).values({
    id: nanoid(),
    threadId,
    gmailMessageId: `${gmailThreadId}-m1`,
    direction: "inbound",
    fromAddr: from,
    subject,
    bodyText: "Following up on the proposal.",
    sentAt: new Date(),
  });
  return threadId;
}

export async function run(): Promise<void> {
  section("phase 8 — action gate");
  const graph = buildInboundEmailGraph();
  const nodeById = (id: string) => graph.nodes.find((node) => node.id === id)!;
  const rulesNode = nodeById("u");
  assert(
    nextNode(graph, rulesNode, { action: "none" })?.id === "r",
    "action=none skips drafting and logs directly",
  );
  assert(
    nextNode(graph, rulesNode, { action: "draft" })?.id === "cm",
    "action=draft extracts commitments next",
  );
  assert(
    nextNode(graph, rulesNode, { action: "handoff" })?.id === "cm",
    "action=handoff still runs the drafting path",
  );
  assert(
    nodeById("um")?.type === "update-memory" &&
      graph.edges.some((edge) => edge.from === "f" && edge.to === "um"),
    "auto-memory runs after follow-up scheduling",
  );

  section("phase 8 — bucket precedence (parity + aliases)");
  assert(normalizeView("needs_you") === "needs_reply", "legacy needs_you aliases");
  assert(normalizeView("handled") === "fyi", "legacy handled aliases");
  assert(
    bucketFor({ category: "meeting_request", action: "draft" }) === "needs_reply",
    "meeting requests bucket as needs_reply",
  );
  assert(
    bucketFor({
      category: "awaiting_reply",
      action: "none",
      hasDueFollowup: true,
    }) === "follow_up_today",
    "a due follow-up wins over waiting",
  );
  assert(
    bucketFor({
      category: "awaiting_reply",
      action: "none",
      hasUpcomingMeeting: true,
    }) === "meetings",
    "an upcoming meeting wins over waiting",
  );
  assert(
    bucketFor({ category: "awaiting_reply", action: "none" }) === "waiting",
    "awaiting_reply buckets as waiting",
  );
  assert(
    bucketFor({ category: "fyi", action: "none", aiHandled: true }) === "ai_handled",
    "ai-handled wins over fyi",
  );
  assert(
    bucketFor({ category: "newsletter", action: "none" }) === "fyi",
    "newsletters bucket as fyi",
  );
  assert(
    matchesView("fyi", { category: "invoice", action: "none" }),
    "matchesView mirrors bucketFor",
  );

  const userId = makeTestUserId("phase8");
  await createTestUser(userId);

  try {
    const mailbox = await ensureMailbox({
      userId,
      email: `${userId}@example.com`,
    });
    await pool.query("delete from job_queue where user_id = $1", [userId]);

    section("phase 8 — autonomy precedence");
    const threadId = await seedThread({
      userId,
      mailboxId: mailbox.id,
      gmailThreadId: "p8-thr-1",
      from: "ada@example.com",
    });

    const base = await resolveAutonomy({ userId, threadId });
    assert(
      base.autonomy === "copilot" && base.source === "mailbox",
      "copilot mailbox is the default",
    );

    await setMailboxAutonomy(userId, "autopilot");
    const mailboxAutopilot = await resolveAutonomy({ userId, threadId });
    assert(
      mailboxAutopilot.autonomy === "autopilot" &&
        mailboxAutopilot.source === "mailbox",
      "mailbox change is the effective source",
    );

    await setThreadAutonomy(userId, threadId, "copilot");
    const threadOverride = await resolveAutonomy({ userId, threadId });
    assert(
      threadOverride.autonomy === "copilot" && threadOverride.source === "thread",
      "a thread override beats the mailbox in both directions",
    );

    await setThreadAutonomy(userId, threadId, null);
    const cleared = await resolveAutonomy({ userId, threadId });
    assert(
      cleared.autonomy === "autopilot" && cleared.source === "mailbox",
      "clearing the override falls back to the mailbox",
    );

    await db.insert(contacts).values({
      id: nanoid(),
      userId,
      email: "ada@example.com",
      name: "Ada",
      autonomyOverride: "copilot",
    });
    const contactOverride = await resolveAutonomy({
      userId,
      threadId,
      contactEmail: "ada@example.com",
    });
    assert(
      contactOverride.autonomy === "copilot" && contactOverride.source === "contact",
      "a contact override beats the mailbox",
    );

    section("phase 8 — commitments");
    const dueThread = await seedThread({
      userId,
      mailboxId: mailbox.id,
      gmailThreadId: "p8-thr-2",
      from: "bob@example.com",
      subject: "Deck",
    });
    await db.insert(commitments).values({
      id: nanoid(),
      userId,
      threadId: dueThread,
      contactEmail: "bob@example.com",
      direction: "they_owe",
      description: "send the updated deck",
      dueAt: new Date(Date.now() - 86_400_000),
      status: "open",
    });

    const open = await listOpenCommitments({ userId });
    assert(open.length === 1, "the open promise is listed");
    assert(parseDueAt("not-a-date") === null, "an invalid due date is dropped");
    assert(parseDueAt("2030-01-01") !== null, "a valid due date is parsed");

    const context = await buildDraftContext({
      userId,
      senderEmail: "bob@example.com",
      subject: "Deck",
      text: "Any update?",
      threadId: dueThread,
    });
    assert(
      context.commitments.length === 1 &&
        buildDraftContextPrompt(context).includes("send the updated deck"),
      "open promises are recalled into the draft context",
    );

    const nudge = buildCommitmentNudgeBody({
      direction: "they_owe",
      description: "send the updated deck",
      subject: "Deck",
      contactName: "Bob",
    });
    assert(
      nudge.includes("send the updated deck") && nudge.includes("Bob"),
      "the chaser references the promise and the contact",
    );

    const created = await enqueueDueCommitments();
    assert(created >= 1, "an overdue promise prepares a nudge draft");
    const createdAgain = await enqueueDueCommitments();
    assert(createdAgain === 0, "the nudge job is idempotent per nudge count");

    const pending = await db
      .select({ id: drafts.id })
      .from(drafts)
      .where(
        and(eq(drafts.threadId, dueThread), eq(drafts.status, "pending")),
      );
    assert(pending.length === 1, "exactly one pending nudge draft exists");

    // Extraction is gated: with the setting off, no model call and no rows.
    await db
      .insert(assistantSettings)
      .values({ userId, commitmentsEnabled: false })
      .onConflictDoUpdate({
        target: assistantSettings.userId,
        set: { commitmentsEnabled: false },
      });
    const gated = await extractCommitmentsForThread({ userId, threadId });
    assert(gated.length === 0, "commitment extraction honors the off setting");

    section("phase 8 — catch-up composition (no model)");
    assert(daypartForHour(8) === "morning", "8am is morning");
    assert(daypartForHour(14) === "afternoon", "2pm is afternoon");
    assert(daypartForHour(19) === "evening", "7pm is evening");
    assert(daypartForHour(23) === "night", "11pm is night");
    assert(daypartForHour(3) === "night", "3am is night");
    assert(
      buildCatchUpHeadline({
        name: "Ariyaman",
        daypart: "evening",
        late: false,
      }).startsWith("Good evening, Ariyaman."),
      "an on-time evening greeting stays a plain good evening",
    );
    assert(
      buildCatchUpHeadline({ name: "Ariyaman", daypart: "afternoon", late: true }) ===
        "You're late, Ariyaman.",
      "a late afternoon popup names the lateness",
    );
    assert(
      buildCatchUpHeadline({ name: "Ariyaman", daypart: "night", late: true })
        .toLowerCase()
        .includes("up late"),
      "a late-night popup acknowledges the hour",
    );

    const briefing = await buildBriefing(userId);
    assert(
      typeof briefing.greeting.name === "string" &&
        typeof briefing.greeting.total === "number",
      "the briefing has a greeting",
    );
    assert(
      briefing.counts &&
        typeof briefing.counts.needs_reply === "number" &&
        typeof briefing.counts.fyi === "number",
      "the briefing carries the six-bucket counts",
    );
    assert(briefing.promises.length >= 1, "open promises surface in the briefing");

    const catchUp = buildCatchUp({ briefing, localHour: 14, briefingHour: 8 });
    assert(
      catchUp.headline.startsWith("You're late,"),
      "an afternoon catch-up calls out lateness",
    );
    assert(catchUp.lateLabel !== null, "the popup reports how far past the briefing it is");
    assert(catchUp.options[0]?.id === "catch-up", "catch me up leads the plan");
    assert(
      catchUp.options.some((option) => option.id === "promises"),
      "open promises become a catch-up option",
    );
    assert(
      catchUp.options.some((option) => option.id === "triage"),
      "triage is always offered",
    );

    const early = buildCatchUp({ briefing, localHour: 6, briefingHour: 8 });
    assert(early.lateLabel === null, "an early catch-up is not called late");

    section("phase 8 — auto-memory is opt-in");
    const memoryResult = await updateMemoryStep.run({
      db,
      userId,
      runId: nanoid(),
      state: {
        trigger: { threadId },
        latestMessage: { from: "bob@example.com", text: "Any update?" },
        body: "On it.",
      },
      log: () => {},
      input: {},
    });
    assert(
      (memoryResult as { memoriesStored: number }).memoriesStored === 0,
      "auto-memory stores nothing while the toggle is off",
    );
  } finally {
    await pool.query("delete from job_queue where user_id = $1", [userId]);
    await deleteCommitmentsForUser(userId);
    await deleteTestUser(userId);
  }
}

// Allow running this phase on its own (`npm run test:briefing`). When imported
// by run-all.ts, argv[1] is the runner, so this does not fire.
if (process.argv[1]?.includes("phase8-briefing")) {
  run()
    .then(() => {
      if (getFailureCount() > 0) process.exit(1);
      console.log("\nphase 8 checks passed.");
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
