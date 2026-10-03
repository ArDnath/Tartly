import "dotenv/config";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db, pool } from "../../lib/db";
import {
  autopilotDecisions,
  autopilotPolicies,
  contacts,
  drafts,
  flowRuns,
  flows,
  mailboxes,
  messages,
  threadStates,
  threads,
} from "../../lib/db/schema";
import { egressStep } from "../../lib/engine/steps/egress";
import { evaluateGuardrails } from "../../lib/engine/steps/guardrails";
import { enqueueJob } from "../../lib/queue/queue";
import { ensureMailbox } from "../../lib/email-operator/mailbox";
import {
  applyPolicyPatch,
  defaultAutopilotPolicy,
  isWithinSendWindow,
} from "../../lib/settings/autopilot";
import { pruneAutopilotDecisions } from "../../lib/settings/autopilot-usage";
import {
  assert,
  createTestUser,
  deleteTestUser,
  getFailureCount,
  makeTestUserId,
  section,
} from "./harness";

type EgressResult = {
  decision: "draft" | "send";
  reason: string;
  autopilotReason?: string;
};

async function seedFlowRun(userId: string): Promise<string> {
  const flowId = nanoid();
  await db.insert(flows).values({
    id: flowId,
    userId,
    name: `autopilot-test-${flowId}`,
    graph: {},
  });
  const runId = nanoid();
  await db.insert(flowRuns).values({
    id: runId,
    userId,
    flowId,
    triggerKind: "test",
  });
  return runId;
}

async function seedThread({
  userId,
  mailboxId,
  from,
  subject = "Autopilot test thread",
}: {
  userId: string;
  mailboxId: string;
  from: string;
  subject?: string;
}): Promise<{ threadId: string; draftId: string }> {
  const threadId = nanoid();
  await db.insert(threads).values({
    id: threadId,
    mailboxId,
    userId,
    gmailThreadId: nanoid(),
    subject,
    lastMessageAt: new Date(),
  });
  await db.insert(messages).values({
    id: nanoid(),
    threadId,
    gmailMessageId: nanoid(),
    direction: "inbound",
    fromAddr: from,
    subject,
    bodyText: "Can you help with this?",
    sentAt: new Date(Date.now() - 60_000),
  });
  const draftId = nanoid();
  await db.insert(drafts).values({
    id: draftId,
    userId,
    threadId,
    body: "Happy to help.",
    confidence: "HIGH",
    status: "pending",
  });
  await db.insert(threadStates).values({
    threadId,
    category: "needs_reply",
    priority: 60,
    action: "draft",
  });
  return { threadId, draftId };
}

async function setPolicy(
  userId: string,
  mailboxId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const defaults = defaultAutopilotPolicy({ id: nanoid(), mailboxId });
  await db
    .insert(autopilotPolicies)
    .values({
      id: defaults.id,
      userId,
      mailboxId,
      enabled: true,
      mode: "always",
      timezone: "UTC",
      minConfidence: "HIGH",
      requireKnownSender: true,
      allowedCategories: ["needs_reply"],
      maxPerHour: 100,
      maxPerDay: 100,
      maxPerThread: 100,
      loopThreshold: 100,
      ...patch,
    })
    .onConflictDoUpdate({
      target: autopilotPolicies.mailboxId,
      set: { ...patch, updatedAt: new Date() },
    });
}

async function runEgress({
  userId,
  runId,
  threadId,
  draftId,
  from,
  state = {},
}: {
  userId: string;
  runId: string;
  threadId: string;
  draftId: string;
  from: string;
  state?: Record<string, unknown>;
}): Promise<EgressResult> {
  const result = await egressStep.run({
    db,
    userId,
    runId,
    log: () => {},
    input: {},
    state: {
      trigger: { threadId },
      thread: { id: threadId, mailboxId: "", subject: "s" },
      category: "needs_reply",
      confidence: "HIGH",
      contact: { email: from },
      forcedDraft: false,
      draftId,
      latestMessage: { from, subject: "s", text: "t" },
      body: "Happy to help.",
      ...state,
    },
  });
  return result as EgressResult;
}

export async function run(): Promise<void> {
  const userId = makeTestUserId("phaseautopilot");
  const runId = await (async () => {
    await createTestUser(userId, "Autopilot Test");
    return seedFlowRun(userId);
  })();
  const mailbox = await ensureMailbox({
    userId,
    email: `${userId}@example.com`,
  });

  try {
    /* --- 1. Copilot never sends (INV-01) --------------------------------- */
    section("phase autopilot — copilot is unchanged");
    await db
      .update(mailboxes)
      .set({ autonomy: "copilot" })
      .where(eq(mailboxes.id, mailbox.id));
    const copilotCase = await seedThread({
      userId,
      mailboxId: mailbox.id,
      from: "known-copilot@example.com",
    });
    await db.insert(contacts).values({
      id: nanoid(),
      userId,
      email: "known-copilot@example.com",
      source: "test",
    });
    await setPolicy(userId, mailbox.id, { enabled: true });
    const copilot = await runEgress({
      userId,
      runId,
      threadId: copilotCase.threadId,
      draftId: copilotCase.draftId,
      from: "known-copilot@example.com",
    });
    assert(copilot.decision === "draft", "copilot drafts");
    assert(
      copilot.reason.includes("copilot"),
      "copilot reason names the copilot path",
    );

    /* --- 2. Autopilot in-window eligible sends (INV-02) ------------------ */
    section("phase autopilot — eligible send + audit");
    await db
      .update(mailboxes)
      .set({ autonomy: "autopilot" })
      .where(eq(mailboxes.id, mailbox.id));
    const eligible = await seedThread({
      userId,
      mailboxId: mailbox.id,
      from: "known-send@example.com",
    });
    await db.insert(contacts).values({
      id: nanoid(),
      userId,
      email: "known-send@example.com",
      source: "test",
    });
    await setPolicy(userId, mailbox.id, {
      enabled: true,
      mode: "always",
      requireKnownSender: true,
    });
    const sent = await runEgress({
      userId,
      runId,
      threadId: eligible.threadId,
      draftId: eligible.draftId,
      from: "known-send@example.com",
    });
    assert(sent.decision === "send", "eligible autopilot send");
    assert(sent.reason === "autopilot", "send reason is autopilot");

    const audit = await db
      .select()
      .from(autopilotDecisions)
      .where(
        and(
          eq(autopilotDecisions.userId, userId),
          eq(autopilotDecisions.threadId, eligible.threadId),
        ),
      );
    assert(audit.length >= 1, "a decision row was written");
    const row = audit[0]!;
    assert(row.decision === "send", "audit records the send");
    assert(
      !("body" in row) && !("subject" in row),
      "audit row is content-free (INV-11)",
    );
    assert(
      typeof row.checks === "object" && row.checks !== null,
      "audit stores boolean checks",
    );

    /* --- 3. Outside window ---------------------------------------------- */
    section("phase autopilot — window enforcement (INV-04)");
    const hour = new Date().getUTCHours();
    const outside = await seedThread({
      userId,
      mailboxId: mailbox.id,
      from: "known-window@example.com",
    });
    await db.insert(contacts).values({
      id: nanoid(),
      userId,
      email: "known-window@example.com",
      source: "test",
    });
    await setPolicy(userId, mailbox.id, {
      mode: "window",
      timezone: "UTC",
      windowStartHour: (hour + 1) % 24,
      windowEndHour: (hour + 2) % 24,
      requireKnownSender: true,
    });
    const windowed = await runEgress({
      userId,
      runId,
      threadId: outside.threadId,
      draftId: outside.draftId,
      from: "known-window@example.com",
    });
    assert(windowed.decision === "draft", "outside window drafts");
    assert(windowed.reason === "outside_window", "reason is outside_window");

    /* --- 4. Unknown sender ---------------------------------------------- */
    section("phase autopilot — unknown sender (INV-06)");
    const unknown = await seedThread({
      userId,
      mailboxId: mailbox.id,
      from: `stranger-${nanoid()}@example.com`,
    });
    await setPolicy(userId, mailbox.id, {
      mode: "always",
      requireKnownSender: true,
    });
    const unknownResult = await runEgress({
      userId,
      runId,
      threadId: unknown.threadId,
      draftId: unknown.draftId,
      from: `stranger-${nanoid()}@example.com`,
    });
    assert(unknownResult.reason === "unknown_sender", "unknown sender drafts");

    /* --- 5. Null confidence / category fail closed ----------------------- */
    section("phase autopilot — null category/confidence (F-19)");
    const nullCase = await seedThread({
      userId,
      mailboxId: mailbox.id,
      from: "known-null@example.com",
    });
    await db.insert(contacts).values({
      id: nanoid(),
      userId,
      email: "known-null@example.com",
      source: "test",
    });
    await setPolicy(userId, mailbox.id, {
      mode: "always",
      requireKnownSender: true,
    });
    const nullResult = await runEgress({
      userId,
      runId,
      threadId: nullCase.threadId,
      draftId: nullCase.draftId,
      from: "known-null@example.com",
      state: { category: null, confidence: null },
    });
    assert(
      nullResult.reason === "low_confidence",
      "null confidence fails closed at the confidence check",
    );

    const nullCategory = await runEgress({
      userId,
      runId,
      threadId: nullCase.threadId,
      draftId: nullCase.draftId,
      from: "known-null@example.com",
      state: { category: null, confidence: "HIGH" },
    });
    assert(
      nullCategory.reason === "category_not_allowed",
      "null category fails closed at the category check",
    );

    /* --- 6. Guardrails force a draft (INV-05) ---------------------------- */
    section("phase autopilot — guardrails");
    const commitment = evaluateGuardrails({
      body: "I promise to send the invoice by tomorrow. The fee is $900.",
      contextText: "Quick question about your service.",
      sender: { from: "known@example.com", subject: "Hi" },
    });
    assert(
      commitment.violations.some((v) => v.startsWith("commitment_language")),
      "commitment/price is flagged",
    );
    const autoResponder = evaluateGuardrails({
      body: "Thanks for the note.",
      contextText: "Automatic reply: I am out of office.",
      sender: { from: "no-reply@example.com", subject: "Automatic reply" },
    });
    assert(
      autoResponder.violations.some((v) => v.startsWith("auto_responder")),
      "auto-responder/no-reply is flagged",
    );

    /* --- 7. Day cap ------------------------------------------------------ */
    section("phase autopilot — caps");
    const capThread = await seedThread({
      userId,
      mailboxId: mailbox.id,
      from: "known-cap@example.com",
    });
    await db.insert(contacts).values({
      id: nanoid(),
      userId,
      email: "known-cap@example.com",
      source: "test",
    });
    await db.insert(drafts).values({
      id: nanoid(),
      userId,
      threadId: capThread.threadId,
      body: "sent",
      status: "sent",
      sentBy: "ai",
      decidedAt: new Date(),
    });
    await setPolicy(userId, mailbox.id, {
      mode: "always",
      requireKnownSender: true,
      maxPerDay: 1,
      maxPerThread: 100,
    });
    const capped = await runEgress({
      userId,
      runId,
      threadId: capThread.threadId,
      draftId: capThread.draftId,
      from: "known-cap@example.com",
    });
    assert(capped.reason === "day_cap", "day cap blocks");

    /* --- 8. Loop detection ---------------------------------------------- */
    section("phase autopilot — loop protection");
    const loopThread = await seedThread({
      userId,
      mailboxId: mailbox.id,
      from: "known-loop@example.com",
    });
    await db.insert(contacts).values({
      id: nanoid(),
      userId,
      email: "known-loop@example.com",
      source: "test",
    });
    await db.insert(drafts).values({
      id: nanoid(),
      userId,
      threadId: loopThread.threadId,
      body: "sent",
      status: "sent",
      sentBy: "ai",
      decidedAt: new Date(),
    });
    await setPolicy(userId, mailbox.id, {
      mode: "always",
      requireKnownSender: true,
      maxPerDay: 100,
      maxPerThread: 100,
      loopThreshold: 1,
    });
    const looped = await runEgress({
      userId,
      runId,
      threadId: loopThread.threadId,
      draftId: loopThread.draftId,
      from: "known-loop@example.com",
    });
    assert(looped.reason === "loop_detected", "loop threshold blocks");

    /* --- 9. Replay dedupe (INV-08) --------------------------------------- */
    section("phase autopilot — event/job dedupe");
    const sourceEventId = `autopilot-test:${nanoid()}`;
    const first = await enqueueJob(pool, userId, {
      kind: "inbound_email",
      laneKey: `mailbox:${mailbox.id}`,
      payload: { mailboxId: mailbox.id },
      sourceEventId,
    });
    const second = await enqueueJob(pool, userId, {
      kind: "inbound_email",
      laneKey: `mailbox:${mailbox.id}`,
      payload: { mailboxId: mailbox.id },
      sourceEventId,
    });
    assert(first.deduped === false && second.deduped === true, "replay is deduped");

    /* --- 10. Policy clamping --------------------------------------------- */
    section("phase autopilot — server clamps caps");
    const clamped = applyPolicyPatch(
      defaultAutopilotPolicy({ id: "x", mailboxId: mailbox.id }),
      { maxPerDay: 10_000, allowedCategories: ["nonsense"] },
    );
    assert(
      (clamped.maxPerDay ?? 0) <= 50,
      "day cap is clamped to the platform ceiling",
    );
    assert(
      clamped.allowedCategories?.length === 0,
      "unknown categories are dropped",
    );

    /* --- 11. Window math sanity ------------------------------------------ */
    assert(
      isWithinSendWindow(new Date(), {
        ...defaultAutopilotPolicy({ id: "x", mailboxId: mailbox.id }),
        mode: "always",
      }),
      "always mode is inside the window",
    );

    /* --- 12. Retention ---------------------------------------------------- */
    section("phase autopilot — retention");
    const oldThread = await seedThread({
      userId,
      mailboxId: mailbox.id,
      from: "known-old@example.com",
    });
    await db.insert(autopilotDecisions).values({
      id: nanoid(),
      userId,
      mailboxId: mailbox.id,
      threadId: oldThread.threadId,
      decision: "draft",
      reason: "outside_window",
      createdAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000),
    });
    const pruned = await pruneAutopilotDecisions(
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    );
    assert(pruned >= 1, "old decisions are pruned");
  } finally {
    await db.delete(autopilotDecisions).where(eq(autopilotDecisions.userId, userId));
    await db.delete(autopilotPolicies).where(eq(autopilotPolicies.userId, userId));
    await deleteTestUser(userId);
  }
}

if (process.argv[1]?.includes("phase-autopilot")) {
  run()
    .then(() => {
      if (getFailureCount() > 0) process.exit(1);
      console.log("\nphase autopilot checks passed.");
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
