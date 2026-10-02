import "dotenv/config";

import { and, eq } from "drizzle-orm";

import type { AgentContext } from "../../lib/agent/context";
import { createRegistryActionExecutor } from "../../lib/agent/confirmation";
import { buildToolSet } from "../../lib/agent/loop";
import { decideToolPermission } from "../../lib/agent/permissions";
import { createToolRegistry } from "../../lib/agent/registry";
import {
  createDefaultToolRegistry,
  READ_TOOLS,
  SIDE_EFFECT_TOOLS,
  WRITE_TOOLS,
} from "../../lib/agent/tools";
import { createDeleteEmailTool } from "../../lib/agent/tools/delete-email";
import { createGetContactTool } from "../../lib/agent/tools/get-contact";
import { createScheduleEmailTool } from "../../lib/agent/tools/schedule-email";
import { createSearchContactsTool } from "../../lib/agent/tools/search-contacts";
import { createChatThread } from "../../lib/ai/chat-service";
import { db, pool } from "../../lib/db";
import { jobQueue, scheduledActions, user } from "../../lib/db/schema";
import type { GmailTransport } from "../../lib/gmail/client";
import { sendEmail } from "../../lib/gmail/send";
import { createGmailEmailProvider } from "../../lib/providers/email/gmail-provider";
import type { EmailCorrespondent } from "../../lib/providers/email/types";
import { ActionService } from "../../lib/services/action-service";
import { ContactService } from "../../lib/services/contact-service";
import { EmailService } from "../../lib/services/email-service";
import { ScheduleService } from "../../lib/services/schedule-service";
import { SendService } from "../../lib/services/send-service";
import { JOB_KIND_SCHEDULED_EMAIL } from "../../lib/email-operator/job-kinds";

/**
 * Phase 4 tests (brief Phase 6b): destructive, scheduled and contacts.
 *
 * Adversarial first, always against the safety invariants:
 *   - `delete_email` is trash-only and never executes from the model's decision;
 *   - a scheduled send is confirmation-gated, fires once, and is idempotent
 *     under a double-fire;
 *   - contact lookup never fabricates a person and marks unseen addresses
 *     UNVERIFIED_CONTACT;
 *   - every new side effect is classified and routed through confirmation;
 *   - user B cannot touch user A's schedule/action.
 *
 * In-memory Gmail transport + the real database; no network.
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

type ExecutableTool = {
  execute: (
    input: unknown,
    options: { toolCallId: string; abortSignal?: AbortSignal },
  ) => Promise<unknown>;
};

function executable(tools: Record<string, unknown>, name: string): ExecutableTool {
  const tool = tools[name];
  if (!tool) throw new Error(`tool ${name} was not registered`);
  return tool as unknown as ExecutableTool;
}

// --------------------------------------------------------------------------
// In-memory Gmail fake (trash-capable)
// --------------------------------------------------------------------------

interface FakeGmail {
  calls: Array<{ method: string; path: string; body?: unknown }>;
  seq: number;
}

function createFakeGmail(): FakeGmail {
  return { calls: [], seq: 0 };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createFakeTransport(state: FakeGmail): GmailTransport {
  return async (_userId, path, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    state.calls.push({
      method,
      path,
      ...(init?.body ? { body: JSON.parse(String(init.body)) as unknown } : {}),
    });
    const pathname = new URL(path, "https://gmail.test").pathname;

    if (pathname === "/profile" && method === "GET") {
      return json({ emailAddress: "me@example.com", messagesTotal: 0 });
    }
    if (pathname === "/labels" && method === "GET") return json({ labels: [] });
    if (pathname === "/messages/send" && method === "POST") {
      state.seq += 1;
      return json({ id: `sent_${state.seq}`, threadId: `sent_thread_${state.seq}` });
    }
    if (/^\/messages\/[^/]+\/(trash|untrash)$/.test(pathname) && method === "POST") {
      return new Response(null, { status: 204 });
    }
    if (pathname === "/messages/batchModify" && method === "POST") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Fake Gmail: unhandled ${method} ${path}`);
  };
}

function testSendService(state: FakeGmail): SendService {
  const transport = createFakeTransport(state);
  return new SendService({
    provider: createGmailEmailProvider(transport),
    send: (input) => sendEmail({ ...input, transport }),
    getProfile: async () => ({ emailAddress: "me@example.com", messagesTotal: 0 }),
    allowSend: async () => true,
  });
}

function testEmailService(state: FakeGmail): EmailService {
  return new EmailService(createGmailEmailProvider(createFakeTransport(state)));
}

function callPaths(state: FakeGmail): string[] {
  return state.calls.map((call) => call.path);
}

function sendCount(state: FakeGmail): number {
  return state.calls.filter((call) => call.path === "/messages/send").length;
}

// --------------------------------------------------------------------------
// Contact fixtures
// --------------------------------------------------------------------------

const CORRESPONDENTS: EmailCorrespondent[] = [
  {
    email: "jane@acme.com",
    name: "Jane Doe",
    sent: 3,
    received: 5,
    lastSeen: "2026-09-20T10:00:00.000Z",
  },
  {
    email: "bob@widgets.io",
    name: "Bob Smith",
    sent: 1,
    received: 0,
    lastSeen: "2026-08-01T10:00:00.000Z",
  },
  {
    email: "alerts@noreply.service.com",
    name: "Service Alerts",
    sent: 0,
    received: 12,
    lastSeen: "2026-09-24T10:00:00.000Z",
  },
];

function testContactService(): ContactService {
  return new ContactService({
    listCorrespondents: async ({ limit }) =>
      CORRESPONDENTS.slice(0, limit ?? CORRESPONDENTS.length),
  });
}

// --------------------------------------------------------------------------
// Database fixtures
// --------------------------------------------------------------------------

let seq = 0;
async function makeUserWithThread(): Promise<{ userId: string; conversationId: string }> {
  seq += 1;
  const userId = `agent-phase4-${Date.now()}-${seq}`;
  await db.insert(user).values({ id: userId, name: "P4", email: `${userId}@example.com` });
  const thread = await createChatThread(userId);
  return { userId, conversationId: thread.id };
}

async function cleanup(users: string[]): Promise<void> {
  for (const id of users) await db.delete(user).where(eq(user.id, id));
}

// --------------------------------------------------------------------------
// Registry + schema
// --------------------------------------------------------------------------

function runRegistryTests(): void {
  section("Phase 6b tool registry");

  const names = SIDE_EFFECT_TOOLS.map((tool) => tool.name);
  assert(SIDE_EFFECT_TOOLS.length >= 5, "Phase 6b registers the core side-effect tools");
  assert(
    SIDE_EFFECT_TOOLS.every((tool) => tool.risk === "EXTERNAL_SIDE_EFFECT"),
    "every side-effect tool is classified EXTERNAL_SIDE_EFFECT",
  );
  assert(
    names.includes("delete_email") && names.includes("schedule_email"),
    "delete_email and schedule_email are registered",
  );
  assert(
    READ_TOOLS.some((tool) => tool.name === "search_contacts") &&
      READ_TOOLS.some((tool) => tool.name === "get_contact") &&
      READ_TOOLS.filter((t) => t.name.includes("contact")).every((t) => t.risk === "READ"),
    "contact tools are registered as READ",
  );
  assert(
    WRITE_TOOLS.every((tool) => tool.risk === "WRITE"),
    "write risks are unchanged",
  );

  const registry = createDefaultToolRegistry();
  assert(
    registry.list().length ===
      READ_TOOLS.length + WRITE_TOOLS.length + SIDE_EFFECT_TOOLS.length,
    "the default registry exposes every new tool",
  );
}

function runSchemaTests(): void {
  section("new tool input validation (adversarial)");

  const del = createDeleteEmailTool();
  const sched = createScheduleEmailTool();
  const search = createSearchContactsTool();
  const get = createGetContactTool();

  assert(!del.inputSchema.safeParse({}).success, "delete_email requires a messageId");
  assert(del.inputSchema.safeParse({ messageId: "m1" }).success, "delete_email accepts a messageId");

  assert(
    !sched.inputSchema.safeParse({ to: ["a@b.com"], body: "hi" }).success,
    "schedule_email requires sendAt",
  );
  assert(
    !sched.inputSchema.safeParse({ to: [], body: "hi", sendAt: "2030-01-01T00:00:00Z" }).success,
    "schedule_email requires a recipient",
  );
  assert(
    !sched.inputSchema.safeParse({ to: ["a@b.com"], body: "hi", sendAt: "not-a-date" }).success,
    "schedule_email rejects a malformed timestamp",
  );
  assert(
    sched.inputSchema.safeParse({
      to: ["a@b.com"],
      subject: "Hi",
      body: "Hello",
      sendAt: "2030-01-01T09:00:00Z",
    }).success,
    "schedule_email accepts a valid scheduled message",
  );

  assert(search.inputSchema.safeParse({}).success, "search_contacts allows an empty query");
  assert(!get.inputSchema.safeParse({}).success, "get_contact requires an email or a name");
  assert(get.inputSchema.safeParse({ email: "a@b.com" }).success, "get_contact accepts an email");
  assert(get.inputSchema.safeParse({ name: "Jane" }).success, "get_contact accepts a name");
}

// --------------------------------------------------------------------------
// delete_email: trash only, confirmation-gated
// --------------------------------------------------------------------------

async function runDeleteTests(): Promise<void> {
  section("delete_email trashes (never hard-deletes) and never auto-runs");

  const state = createFakeGmail();
  const email = testEmailService(state);
  const a = await makeUserWithThread();
  const service = new ActionService();

  try {
    // The model's decision alone: no confirmation channel → refuse.
    const tools = buildToolSet({
      ctx: testCtx(a.userId),
      registry: createToolRegistry([createDeleteEmailTool({ email })]),
      events: () => {},
      getStep: () => 1,
    });
    let refused = false;
    try {
      await executable(tools, "delete_email").execute(
        { messageId: "m1" },
        { toolCallId: "d1" },
      );
    } catch {
      refused = true;
    }
    assert(refused, "delete_email throws with no confirmation channel");
    assert(callPaths(state).length === 0, "the provider is never called without confirmation");

    assert(
      decideToolPermission(testCtx(a.userId), {
        name: "delete_email",
        risk: "EXTERNAL_SIDE_EFFECT",
      }).kind === "require_confirmation",
      "delete_email requires confirmation",
    );

    // Confirm → trash, and only trash.
    const action = await service.createPendingAction({
      userId: a.userId,
      conversationId: a.conversationId,
      toolName: "delete_email",
      args: { messageId: "m1" },
    });
    await service.confirmAction({
      userId: a.userId,
      actionId: action.id,
      executor: createRegistryActionExecutor({
        registry: createToolRegistry([createDeleteEmailTool({ email })]),
        ctx: testCtx(a.userId),
      }),
    });

    const paths = callPaths(state);
    assert(
      paths.includes("/messages/m1/trash"),
      "delete_email calls Gmail's trash endpoint",
    );
    assert(
      !state.calls.some((call) => call.method === "DELETE"),
      "delete_email never issues a hard delete",
    );
    assert(
      paths.includes("/messages/m1/trash") && !paths.includes("/messages/m1/untrash"),
      "delete_email does not untrash",
    );

    // Restorable: the same service can restore.
    await email.untrashMessage({ userId: a.userId, messageId: "m1" });
    assert(
      callPaths(state).includes("/messages/m1/untrash"),
      "trashed mail can be restored (untrash)",
    );
  } finally {
    await cleanup([a.userId]);
  }
}

// --------------------------------------------------------------------------
// schedule_email: confirmation-gated, fires once
// --------------------------------------------------------------------------

async function runScheduleTests(): Promise<void> {
  section("schedule_email is confirmation-gated and fires at-most-once");

  const state = createFakeGmail();
  const sender = testSendService(state);
  const scheduler = new ScheduleService(sender);
  const a = await makeUserWithThread();
  const service = new ActionService();
  const sendAt = new Date(Date.now() + 60 * 60 * 1000);

  try {
    // The tool refuses without a confirmed action identity.
    const tool = createScheduleEmailTool({ scheduler });
    let directRefused = false;
    try {
      await tool.execute(testCtx(a.userId), {
        to: ["jane@acme.com"],
        subject: "Later",
        body: "Hello future",
        sendAt: sendAt.toISOString(),
      });
    } catch {
      directRefused = true;
    }
    assert(directRefused, "schedule_email refuses without a confirmed action");
    assert(sendCount(state) === 0, "nothing is sent by proposing a schedule");

    // Confirm the schedule: a row + a job, but no send yet.
    const action = await service.createPendingAction({
      userId: a.userId,
      conversationId: a.conversationId,
      toolName: "schedule_email",
      args: {
        to: ["jane@acme.com"],
        subject: "Later",
        body: "Hello future",
        sendAt: sendAt.toISOString(),
      },
    });
    const result = (await service.confirmAction({
      userId: a.userId,
      actionId: action.id,
      executor: createRegistryActionExecutor({
        registry: createToolRegistry([createScheduleEmailTool({ scheduler })]),
        ctx: testCtx(a.userId),
      }),
    })) as { result?: { scheduledActionId?: string } };

    const scheduledActionId = result.result?.scheduledActionId;
    assert(Boolean(scheduledActionId), "confirming creates a scheduled action");
    assert(sendCount(state) === 0, "confirming a schedule does not send immediately");

    const rows = await db
      .select()
      .from(scheduledActions)
      .where(eq(scheduledActions.pendingActionId, action.id));
    assert(rows.length === 1 && rows[0]!.status === "pending", "one pending scheduled action exists");

    const jobs = await db
      .select()
      .from(jobQueue)
      .where(
        and(
          eq(jobQueue.userId, a.userId),
          eq(jobQueue.kind, JOB_KIND_SCHEDULED_EMAIL),
        ),
      );
    assert(jobs.length === 1, "one scheduled_email job is enqueued");
    assert(
      Boolean(jobs[0]!.runAfter) && jobs[0]!.runAfter.getTime() > Date.now(),
      "the job is future-dated (runAfter)",
    );

    // Rescheduling the same action is idempotent.
    const again = await scheduler.scheduleEmail(
      {
        userId: a.userId,
        pendingActionId: action.id,
        runAfter: sendAt,
        to: ["jane@acme.com"],
        body: "Hello future",
      },
      new Date(),
    );
    assert(again.existing && again.scheduledActionId === scheduledActionId, "rescheduling returns the existing row");

    // Fire it.
    const fired = await scheduler.processScheduledAction({ scheduledActionId: scheduledActionId! });
    assert(fired.processed && !fired.deduped, "the scheduled send fires once");
    assert(sendCount(state) === 1, "exactly one email is sent at fire time");

    const done = await db
      .select()
      .from(scheduledActions)
      .where(eq(scheduledActions.id, scheduledActionId!));
    assert(done[0]!.status === "done", "the scheduled action is marked done");

    // A re-fire is a no-op (already claimed/done).
    const refire = await scheduler.processScheduledAction({ scheduledActionId: scheduledActionId! });
    assert(!refire.processed, "a re-fired job does nothing");
    assert(sendCount(state) === 1, "a re-fire sends nothing");

    // Even if the row were reset, the ledger still prevents a duplicate.
    await db
      .update(scheduledActions)
      .set({ status: "pending" })
      .where(eq(scheduledActions.id, scheduledActionId!));
    const replayed = await scheduler.processScheduledAction({ scheduledActionId: scheduledActionId! });
    assert(replayed.deduped, "a reset-and-replay is deduped by the send ledger");
    assert(sendCount(state) === 1, "the ledger makes the scheduled send at-most-once");

    // Owner scoping: user B sees nothing.
    const b = await makeUserWithThread();
    try {
      let notFound = false;
      try {
        await scheduler.getScheduledAction({ userId: b.userId, scheduledActionId: scheduledActionId! });
      } catch {
        notFound = true;
      }
      assert(notFound, "user B cannot read user A's scheduled action");
    } finally {
      await cleanup([b.userId]);
    }
  } finally {
    await cleanup([a.userId]);
  }
}

async function runScheduleValidationTests(): Promise<void> {
  section("schedule_email rejects impossible times");

  const scheduler = new ScheduleService(testSendService(createFakeGmail()));
  const a = await makeUserWithThread();
  try {
    const base = {
      userId: a.userId,
      pendingActionId: "action_x",
      to: ["jane@acme.com"],
      body: "hi",
    };

    let past = false;
    try {
      await scheduler.scheduleEmail({ ...base, runAfter: new Date(Date.now() - 60_000) });
    } catch {
      past = true;
    }
    assert(past, "a past sendAt is rejected");

    let tooFar = false;
    try {
      await scheduler.scheduleEmail({
        ...base,
        runAfter: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000),
      });
    } catch {
      tooFar = true;
    }
    assert(tooFar, "a send more than a year out is rejected");
  } finally {
    await cleanup([a.userId]);
  }
}

// --------------------------------------------------------------------------
// Contacts
// --------------------------------------------------------------------------

async function runContactTests(): Promise<void> {
  section("contact lookup never fabricates a person");

  const contacts = testContactService();

  const found = await contacts.searchContacts({ userId: "u1", query: "jane" });
  assert(found.length === 1 && found[0]!.email === "jane@acme.com", "search finds a known correspondent");
  assert(found[0]!.trust === "KNOWN_CONTACT", "an observed correspondent is a KNOWN_CONTACT");
  assert(found[0]!.sent === 3 && found[0]!.received === 5, "exchanges are reported");

  const byDomain = await contacts.searchContacts({ userId: "u1", query: "widgets.io" });
  assert(byDomain.length === 1 && byDomain[0]!.email === "bob@widgets.io", "search matches on domain");

  const none = await contacts.searchContacts({ userId: "u1", query: "nobody-here" });
  assert(none.length === 0, "a missing contact returns no rows, not a guess");

  const known = await contacts.getContact({ userId: "u1", email: "jane@acme.com" });
  assert(known?.trust === "KNOWN_CONTACT", "get_contact resolves a known address");

  const unseen = await contacts.getContact({ userId: "u1", email: "stranger@example.com" });
  assert(
    unseen?.trust === "UNVERIFIED_CONTACT" && unseen.sent === 0,
    "an unseen but valid address is UNVERIFIED_CONTACT",
  );

  const unreachable = await contacts.getContact({ userId: "u1", email: "noreply@example.com" });
  assert(unreachable?.reachable === false, "an automated sender is flagged unreachable");

  const missingByName = await contacts.getContact({ userId: "u1", name: "Nobody" });
  assert(missingByName === null, "a name that matches nobody returns null");

  const byName = await contacts.getContact({ userId: "u1", name: "Jane Doe" });
  assert(byName?.email === "jane@acme.com", "get_contact resolves a name match");

  // Tool shape: `found: false` is a first-class answer.
  const get = createGetContactTool({ contacts });
  const notFound = (await get.execute(testCtx("u1"), { name: "Nobody" })) as {
    found?: boolean;
  };
  assert(notFound.found === false, "get_contact returns found:false rather than inventing");
}

// --------------------------------------------------------------------------
// Authorization
// --------------------------------------------------------------------------

async function runAuthorizationTests(): Promise<void> {
  section("Phase 6b tools honour the context permissions");

  assert(
    decideToolPermission(testCtx("u", { canSend: false }), {
      name: "delete_email",
      risk: "EXTERNAL_SIDE_EFFECT",
    }).kind === "deny",
    "delete_email is denied when side effects are disabled",
  );
  assert(
    decideToolPermission(testCtx("u", { canRead: false }), {
      name: "search_contacts",
      risk: "READ",
    }).kind === "deny",
    "search_contacts is denied when reads are disabled",
  );

  const search = createSearchContactsTool({ contacts: testContactService() });
  const tools = buildToolSet({
    ctx: testCtx("u", { canRead: false }),
    registry: createToolRegistry([search]),
    events: () => {},
    getStep: () => 1,
  });
  let denied = false;
  try {
    await executable(tools, "search_contacts").execute({}, { toolCallId: "c_read" });
  } catch {
    denied = true;
  }
  assert(denied, "a read-denied account cannot search contacts");
}

async function main(): Promise<void> {
  runRegistryTests();
  runSchemaTests();
  await runDeleteTests();
  await runScheduleTests();
  await runScheduleValidationTests();
  await runContactTests();
  await runAuthorizationTests();

  await pool.end().catch(() => {});

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll Phase 4 (destructive / scheduled / contacts) checks passed.");
  process.exit(0);
}

main().catch((error) => {
  console.error("\nAgent Phase 4 test run failed:", error);
  process.exit(1);
});
