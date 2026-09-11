import "dotenv/config";

import { eq } from "drizzle-orm";
import { z } from "zod";

import type { AgentContext } from "../../lib/agent/context";
import {
  createRegistryActionExecutor,
  type ConfirmationRequest,
} from "../../lib/agent/confirmation";
import { ConflictError, NotFoundError, ValidationError } from "../../lib/agent/errors";
import { buildToolSet } from "../../lib/agent/loop";
import { decideToolPermission } from "../../lib/agent/permissions";
import { createToolRegistry, defineTool } from "../../lib/agent/registry";
import {
  createDefaultToolRegistry,
  READ_TOOLS,
  SIDE_EFFECT_TOOLS,
  WRITE_TOOLS,
} from "../../lib/agent/tools";
import { createForwardEmailTool } from "../../lib/agent/tools/forward-email";
import { createReplyToEmailTool } from "../../lib/agent/tools/reply-to-email";
import { createSendEmailTool } from "../../lib/agent/tools/send-email";
import { createChatThread } from "../../lib/ai/chat-service";
import { deriveActionIdempotencyKey } from "../../lib/ai/idempotency";
import { hashArguments } from "../../lib/agent/action-hash";
import { db } from "../../lib/db";
import { user } from "../../lib/db/schema";
import type { GmailTransport } from "../../lib/gmail/client";
import { toBase64Url } from "../../lib/gmail/mime";
import { decodeBase64Url } from "../../lib/gmail/parse";
import { sendEmail } from "../../lib/gmail/send";
import { createGmailEmailProvider } from "../../lib/providers/email/gmail-provider";
import {
  ActionService,
  type ActionExecutor,
} from "../../lib/services/action-service";
import { SendService } from "../../lib/services/send-service";

/**
 * Phase 3 tests (brief Phases 7–8): confirmation + send.
 *
 * Adversarial first. These assert the safety invariants, never model prose:
 *   - a side effect is never executed by the model's decision alone;
 *   - the model's arguments are frozen at creation and tamper-checked;
 *   - exactly one concurrent confirm wins the PENDING → EXECUTING race;
 *   - an expired, cancelled or already-decided action cannot execute;
 *   - user B cannot read or confirm user A's action;
 *   - a double-click, two tabs or a replay cannot send twice (ledger + atomic
 *     transition);
 *   - the send path is the only outbound path and it is server-keyed.
 *
 * Everything runs against an in-memory Gmail transport and the real database —
 * no network needed.
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
// In-memory Gmail fake (send-capable)
// --------------------------------------------------------------------------

type FakeMessage = {
  id: string;
  threadId: string;
  labelIds: string[];
  headers: Array<{ name: string; value: string }>;
  body: string;
  internalDate: string;
  historyId: string;
};

interface FakeGmail {
  messages: Map<string, FakeMessage>;
  calls: Array<{ method: string; path: string; body?: unknown }>;
  seq: number;
}

function createFakeGmail(): FakeGmail {
  return { messages: new Map(), calls: [], seq: 0 };
}

function fakeMessage(overrides: Partial<FakeMessage> = {}): FakeMessage {
  return {
    id: "m1",
    threadId: "t1",
    labelIds: ["INBOX", "UNREAD"],
    headers: [
      { name: "From", value: "Jane <jane@acme.com>" },
      { name: "To", value: "me@example.com" },
      { name: "Subject", value: "Pricing" },
      { name: "Message-ID", value: "<parent@acme.com>" },
      { name: "In-Reply-To", value: "<root@acme.com>" },
    ],
    body: "Hello there",
    internalDate: "1000",
    historyId: "1",
    ...overrides,
  };
}

function messageResource(message: FakeMessage) {
  return {
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds,
    internalDate: message.internalDate,
    historyId: message.historyId,
    snippet: message.body.slice(0, 80),
    payload: {
      mimeType: "text/plain",
      headers: message.headers,
      body: { size: message.body.length, data: toBase64Url(message.body) },
    },
  };
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

    const url = new URL(path, "https://gmail.test");
    const pathname = url.pathname;

    if (pathname === "/profile" && method === "GET") {
      return json({ emailAddress: "me@example.com", messagesTotal: state.messages.size });
    }

    if (pathname === "/labels" && method === "GET") return json({ labels: [] });

    if (pathname === "/messages/send" && method === "POST") {
      state.seq += 1;
      const body = JSON.parse(String(init?.body)) as { threadId?: string };
      return json({ id: `sent_${state.seq}`, threadId: body.threadId ?? `sent_thread_${state.seq}` });
    }

    if (pathname.startsWith("/messages/") && method === "GET") {
      const id = pathname.slice("/messages/".length);
      const message = state.messages.get(id);
      return message
        ? json(messageResource(message))
        : json({ error: { code: 404, message: "Not Found" } }, 404);
    }

    if (pathname === "/messages/batchModify" && method === "POST") {
      return new Response(null, { status: 204 });
    }

    throw new Error(`Fake Gmail: unhandled ${method} ${path}`);
  };
}

/** The raw MIME `messages.send` received, decoded for assertion. */
function lastSentMime(state: FakeGmail): {
  headers: Record<string, string>;
  text: string;
} {
  const send = [...state.calls].reverse().find((call) => call.path === "/messages/send");
  if (!send || !send.body) throw new Error("no send was recorded");
  const raw = (send.body as { raw: string }).raw;
  const mime = decodeBase64Url(raw);
  const separator = mime.indexOf("\r\n\r\n");
  const head = separator >= 0 ? mime.slice(0, separator) : mime;
  const encoded = separator >= 0 ? mime.slice(separator + 4).trim() : "";
  const headers: Record<string, string> = {};
  for (const line of head.split("\r\n")) {
    const index = line.indexOf(": ");
    if (index > 0) headers[line.slice(0, index).toLowerCase()] = line.slice(index + 2);
  }
  return { headers, text: encoded ? decodeBase64Url(encoded) : "" };
}

function sendCount(state: FakeGmail): number {
  return state.calls.filter((call) => call.path === "/messages/send").length;
}

/** A SendService wired to a fake Gmail transport, with a stable From address. */
function testSendService(state: FakeGmail): SendService {
  const transport = createFakeTransport(state);
  return new SendService({
    provider: createGmailEmailProvider(transport),
    send: (input) => sendEmail({ ...input, transport }),
    getProfile: async () => ({ emailAddress: "me@example.com", messagesTotal: 0 }),
    allowSend: async () => true,
  });
}

// --------------------------------------------------------------------------
// Database fixtures
// --------------------------------------------------------------------------

let seq = 0;
async function makeUserWithThread(): Promise<{ userId: string; conversationId: string }> {
  seq += 1;
  const userId = `agent-phase3-${Date.now()}-${seq}`;
  await db.insert(user).values({ id: userId, name: "P3", email: `${userId}@example.com` });
  const thread = await createChatThread(userId);
  return { userId, conversationId: thread.id };
}

async function cleanup(users: string[]): Promise<void> {
  for (const id of users) await db.delete(user).where(eq(user.id, id));
}

// --------------------------------------------------------------------------
// Pure hashing / idempotency
// --------------------------------------------------------------------------

function runHashTests(): void {
  section("argument hashing + server-derived idempotency key");

  assert(
    hashArguments({ b: 2, a: 1 }) === hashArguments({ a: 1, b: 2 }),
    "the arguments hash is order-independent (jsonb does not preserve key order)",
  );
  assert(
    hashArguments({ a: 1 }) !== hashArguments({ a: 2 }),
    "tampering with an argument changes the hash",
  );

  const base = {
    userId: "u1",
    actionId: "a1",
    provider: "gmail",
    argumentsHash: hashArguments({ to: ["a@b.com"], body: "hi" }),
  };
  assert(
    deriveActionIdempotencyKey(base) === deriveActionIdempotencyKey({ ...base }),
    "the idempotency key is deterministic",
  );
  assert(
    deriveActionIdempotencyKey(base) !==
      deriveActionIdempotencyKey({ ...base, actionId: "a2" }),
    "a different action yields a different send key",
  );
  assert(
    deriveActionIdempotencyKey(base) !==
      deriveActionIdempotencyKey({ ...base, argumentsHash: hashArguments({}) }),
    "a different payload yields a different send key",
  );
}

// --------------------------------------------------------------------------
// Registry + schemas
// --------------------------------------------------------------------------

function runRegistryTests(): void {
  section("side-effect tool registry");

  assert(SIDE_EFFECT_TOOLS.length >= 3, "send/reply/forward are registered as side effects");
  assert(
    SIDE_EFFECT_TOOLS.every((tool) => tool.risk === "EXTERNAL_SIDE_EFFECT"),
    "every side-effect tool is classified EXTERNAL_SIDE_EFFECT",
  );
  const names = SIDE_EFFECT_TOOLS.map((tool) => tool.name);
  assert(
    ["send_email", "reply_to_email", "forward_email"].every((name) => names.includes(name)),
    "send / reply / forward are all registered",
  );
  assert(
    READ_TOOLS.every((tool) => tool.risk === "READ") &&
      WRITE_TOOLS.every((tool) => tool.risk === "WRITE"),
    "read and write risks are unchanged",
  );

  const registry = createDefaultToolRegistry();
  assert(
    registry.list().length === READ_TOOLS.length + WRITE_TOOLS.length + SIDE_EFFECT_TOOLS.length,
    "the default registry exposes read, write and side-effect tools",
  );
  assert(
    SIDE_EFFECT_TOOLS.every((tool) => registry.has(tool.name)),
    "side-effect tools are present in the default registry",
  );
}

function runSchemaTests(): void {
  section("side-effect input validation (adversarial)");

  const send = SIDE_EFFECT_TOOLS.find((tool) => tool.name === "send_email")!;
  const reply = SIDE_EFFECT_TOOLS.find((tool) => tool.name === "reply_to_email")!;
  const forward = SIDE_EFFECT_TOOLS.find((tool) => tool.name === "forward_email")!;

  assert(!send.inputSchema.safeParse({ to: [], subject: "x", body: "hi" }).success, "send_email requires a recipient");
  assert(!send.inputSchema.safeParse({ to: ["nope"], subject: "x", body: "hi" }).success, "send_email rejects a malformed recipient");
  assert(!send.inputSchema.safeParse({ to: ["a@b.com"], body: "" }).success, "send_email rejects an empty body");
  assert(
    !send.inputSchema.safeParse({
      to: Array.from({ length: 21 }, (_, i) => `u${i}@x.com`),
      body: "hi",
    }).success,
    "send_email caps the recipient list",
  );
  assert(send.inputSchema.safeParse({ to: ["a@b.com"], subject: "Hi", body: "Hello" }).success, "send_email accepts a valid message");
  assert(
    !("from" in (send.inputSchema as unknown as { shape: Record<string, unknown> }).shape),
    "send_email has no `from` field: the sender is resolved server-side",
  );

  assert(!reply.inputSchema.safeParse({ body: "hi" }).success, "reply_to_email needs the message being replied to");
  assert(!reply.inputSchema.safeParse({ messageId: "m1", body: "" }).success, "reply_to_email needs a body");

  assert(!forward.inputSchema.safeParse({ messageId: "m1" }).success, "forward_email needs a recipient");
  assert(forward.inputSchema.safeParse({ messageId: "m1", to: ["a@b.com"] }).success, "forward_email accepts a valid forward");
}

// --------------------------------------------------------------------------
// Loop policy: side effects never auto-execute
// --------------------------------------------------------------------------

async function runLoopPolicyTests(): Promise<void> {
  section("the loop never executes a side effect on the model's say-so");

  const state = createFakeGmail();
  const sends = testSendService(state);
  const ctx = testCtx("phase3-loop");

  // No confirmation channel wired: refuse.
  const noChannel = buildToolSet({
    ctx,
    registry: createToolRegistry([createSendEmailTool({ sender: sends })]),
    events: () => {},
    getStep: () => 1,
  });
  let refused = false;
  try {
    await executable(noChannel, "send_email").execute(
      { to: ["a@b.com"], subject: "Hi", body: "Hello" },
      { toolCallId: "c1" },
    );
  } catch {
    refused = true;
  }
  assert(refused, "with no confirmation channel a side effect throws");
  assert(sendCount(state) === 0, "the provider is never called without a confirmation channel");

  // Confirmation channel wired: it persists, the provider is not called.
  const seen: ConfirmationRequest[] = [];
  const withChannel = buildToolSet({
    ctx,
    registry: createToolRegistry([createSendEmailTool({ sender: sends })]),
    events: () => {},
    getStep: () => 7,
    onConfirmationRequired: async (request) => {
      seen.push(request);
      return {
        status: "confirmation_required",
        pendingActionId: "action_1",
        tool: request.toolName,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        notice: "confirm",
      };
    },
  });
  const output = (await executable(withChannel, "send_email").execute(
    { to: ["a@b.com"], subject: "Hi", body: "Hello" },
    { toolCallId: "c2" },
  )) as { status?: string; pendingActionId?: string };
  assert(output.status === "confirmation_required", "the tool result asks for confirmation");
  assert(seen.length === 1 && seen[0]!.toolName === "send_email", "the confirmation handler sees the tool");
  assert(seen[0]!.step === 7, "the confirmation request carries the loop step");
  assert(sendCount(state) === 0, "nothing is sent when confirmation is required");

  // Malformed input is rejected before a pending action can even be created.
  let handlerCalls = 0;
  const handlerCounted = buildToolSet({
    ctx,
    registry: createToolRegistry([createSendEmailTool({ sender: sends })]),
    events: () => {},
    getStep: () => 1,
    onConfirmationRequired: async () => {
      handlerCalls += 1;
      return {};
    },
  });
  let malformed = false;
  try {
    await executable(handlerCounted, "send_email").execute(
      { to: ["not-an-email"], body: "Hello" },
      { toolCallId: "c3" },
    );
  } catch {
    malformed = true;
  }
  assert(malformed && handlerCalls === 0, "malformed arguments never create a pending action");

  // A denied account never reaches the confirmation handler.
  let deniedHandlerCalls = 0;
  const denied = buildToolSet({
    ctx: testCtx("phase3-denied", { canSend: false }),
    registry: createToolRegistry([createSendEmailTool({ sender: sends })]),
    events: () => {},
    getStep: () => 1,
    onConfirmationRequired: async () => {
      deniedHandlerCalls += 1;
      return {};
    },
  });
  let deniedThrew = false;
  try {
    await executable(denied, "send_email").execute(
      { to: ["a@b.com"], body: "Hello" },
      { toolCallId: "c4" },
    );
  } catch {
    deniedThrew = true;
  }
  assert(deniedThrew && deniedHandlerCalls === 0, "a denied account cannot create a pending action");
  assert(
    decideToolPermission(testCtx("u"), { name: "send_email", risk: "EXTERNAL_SIDE_EFFECT" }).kind ===
      "require_confirmation",
    "an enabled account still requires confirmation for a side effect",
  );
}

// --------------------------------------------------------------------------
// ActionService state machine (real database)
// --------------------------------------------------------------------------

async function runActionLifecycleTests(): Promise<void> {
  section("pending action lifecycle (atomic, owner-scoped)");

  const a = await makeUserWithThread();
  const b = await makeUserWithThread();
  const service = new ActionService();

  try {
    const action = await service.createPendingAction({
      userId: a.userId,
      conversationId: a.conversationId,
      toolName: "send_email",
      args: { to: ["jane@acme.com"], subject: "Hi", body: "Hello" },
      provider: "gmail",
    });
    assert(action.status === "PENDING", "a new action is PENDING");
    assert(action.argumentsHash === hashArguments(action.arguments), "the stored hash matches the stored arguments");
    assert(action.idempotencyKey.length === 64, "the idempotency key is a server-derived sha256");

    // Owner scoping.
    let missing = false;
    try {
      await service.getAction({ userId: b.userId, actionId: action.id });
    } catch (error) {
      missing = error instanceof NotFoundError;
    }
    assert(missing, "user B cannot read user A's action");

    let crossConfirm = false;
    try {
      await service.confirmAction({
        userId: b.userId,
        actionId: action.id,
        executor: async () => ({}),
      });
    } catch (error) {
      crossConfirm = error instanceof NotFoundError;
    }
    assert(crossConfirm, "user B cannot confirm user A's action");

    // Execute exactly once; a replay returns the prior result.
    let calls = 0;
    const executor: ActionExecutor = async ({ action: row, args }) => {
      calls += 1;
      assert(row.id === action.id, "the executor is handed the persisted action");
      assert(args.body === "Hello", "the executor runs the frozen arguments");
      return { sent: true, gmailMessageId: "sent_1" };
    };
    const first = await service.confirmAction({ userId: a.userId, actionId: action.id, executor });
    assert(first.executed && first.action.status === "SUCCEEDED", "confirming executes once and marks SUCCEEDED");
    assert(calls === 1, "the executor ran exactly once");

    const replay = await service.confirmAction({ userId: a.userId, actionId: action.id, executor });
    assert(!replay.executed && calls === 1, "a replay returns the prior result without re-executing");
    assert(
      (replay.result as { gmailMessageId?: string }).gmailMessageId === "sent_1",
      "the replay returns the stored result",
    );

    // Tampering with the arguments is rejected before the executor runs.
    const tamper = await service.createPendingAction({
      userId: a.userId,
      conversationId: a.conversationId,
      toolName: "send_email",
      args: { to: ["jane@acme.com"], subject: "Hi", body: "Hello" },
    });
    let calls2 = 0;
    let tampered = false;
    try {
      await service.confirmAction({
        userId: a.userId,
        actionId: tamper.id,
        args: { to: ["attacker@evil.com"], subject: "Hi", body: "Hello" },
        executor: async () => {
          calls2 += 1;
          return {};
        },
      });
    } catch (error) {
      tampered = error instanceof ValidationError;
    }
    assert(tampered && calls2 === 0, "confirming with drifted arguments is rejected and never executes");

    // Cancel prevents execution.
    const cancelled = await service.cancelAction({ userId: a.userId, actionId: tamper.id });
    assert(cancelled.status === "CANCELLED", "cancel marks the action CANCELLED");
    let calls3 = 0;
    let cancelledConfirm = false;
    try {
      await service.confirmAction({
        userId: a.userId,
        actionId: tamper.id,
        executor: async () => {
          calls3 += 1;
          return {};
        },
      });
    } catch (error) {
      cancelledConfirm = error instanceof ConflictError;
    }
    assert(cancelledConfirm && calls3 === 0, "a cancelled action cannot be confirmed");

    // Expiry.
    const expiring = await service.createPendingAction({
      userId: a.userId,
      conversationId: a.conversationId,
      toolName: "send_email",
      args: { to: ["jane@acme.com"], body: "Later" },
      ttlMs: -1_000,
    });
    let calls4 = 0;
    let expired = false;
    try {
      await service.confirmAction({
        userId: a.userId,
        actionId: expiring.id,
        executor: async () => {
          calls4 += 1;
          return {};
        },
      });
    } catch (error) {
      expired = error instanceof ConflictError;
    }
    assert(expired && calls4 === 0, "an expired action cannot be confirmed");
    const reread = await service.getAction({ userId: a.userId, actionId: expiring.id });
    assert(reread.status === "EXPIRED", "confirming an expired action marks it EXPIRED");

    // Listing is owner-scoped.
    const listed = await service.listActions({ userId: a.userId });
    assert(
      listed.length > 0 && listed.every((row) => row.userId === a.userId),
      "listing only returns the caller's actions",
    );
    const bListed = await service.listActions({ userId: b.userId });
    assert(bListed.length === 0, "user B sees none of user A's actions");
  } finally {
    await cleanup([a.userId, b.userId]);
  }
}

async function runConcurrencyTests(): Promise<void> {
  section("two confirms race: exactly one executes");

  const a = await makeUserWithThread();
  const service = new ActionService();
  try {
    const action = await service.createPendingAction({
      userId: a.userId,
      conversationId: a.conversationId,
      toolName: "send_email",
      args: { to: ["jane@acme.com"], body: "Hello" },
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const executor: ActionExecutor = async () => {
      calls += 1;
      await gate;
      return { sent: true };
    };

    const winner = service.confirmAction({ userId: a.userId, actionId: action.id, executor });
    // Give the winner time to claim EXECUTING before the loser arrives.
    await new Promise((resolve) => setTimeout(resolve, 50));

    let loserThrew = false;
    try {
      await service.confirmAction({ userId: a.userId, actionId: action.id, executor });
    } catch (error) {
      loserThrew = error instanceof ConflictError;
    }

    release();
    const first = await winner;
    assert(first.executed, "the winner executes");
    assert(calls === 1, "the executor runs exactly once across two concurrent confirms");
    assert(loserThrew, "the loser of the race is refused");
  } finally {
    await cleanup([a.userId]);
  }
}

// --------------------------------------------------------------------------
// Registry executor + send idempotency
// --------------------------------------------------------------------------

async function runRegistryExecutorSendTests(): Promise<void> {
  section("confirm executes the tool once and the ledger makes it at-most-once");

  const a = await makeUserWithThread();
  const state = createFakeGmail();
  const sender = testSendService(state);
  const registry = createToolRegistry([createSendEmailTool({ sender })]);
  const service = new ActionService();

  try {
    const action = await service.createPendingAction({
      userId: a.userId,
      conversationId: a.conversationId,
      toolName: "send_email",
      args: { to: ["Jane <jane@acme.com>"], subject: "Hi", body: "Hello" },
    });

    const executor = createRegistryActionExecutor({
      registry,
      ctx: testCtx(a.userId),
    });
    const result = await service.confirmAction({ userId: a.userId, actionId: action.id, executor });
    assert(result.executed && result.action.status === "SUCCEEDED", "the registry executor completes the action");
    assert(sendCount(state) === 1, "exactly one email is sent");

    const sent = lastSentMime(state);
    assert(sent.headers.to === "jane@acme.com", "the recipient is normalized to a bare address");
    assert(sent.headers.from === "me@example.com", "the sender is resolved server-side");
    assert(sent.text === "Hello", "the body is sent verbatim");

    // A second, independent action with a different id re-sends (a new intent).
    const again = await service.createPendingAction({
      userId: a.userId,
      conversationId: a.conversationId,
      toolName: "send_email",
      args: { to: ["jane@acme.com"], subject: "Hi", body: "Hello" },
    });
    await service.confirmAction({ userId: a.userId, actionId: again.id, executor });
    assert(sendCount(state) === 2, "a distinct confirmed action sends a distinct email");

    // The same key never sends twice even if the ledger path is retried.
    const direct = await sender.sendMessage({
      userId: a.userId,
      idempotencyKey: action.idempotencyKey,
      to: ["jane@acme.com"],
      subject: "Hi",
      body: "Hello",
    });
    assert(direct.deduped, "a ledger replay is deduped and does not send again");
    assert(sendCount(state) === 2, "the deduped retry issues no second provider call");
  } finally {
    await cleanup([a.userId]);
  }
}

async function runReplyForwardTests(): Promise<void> {
  section("reply and forward build the right message");

  const a = await makeUserWithThread();
  const state = createFakeGmail();
  state.messages.set("m1", fakeMessage());
  const sender = testSendService(state);
  const registry = createToolRegistry([
    createReplyToEmailTool({ sender }),
    createForwardEmailTool({ sender }),
  ]);
  const service = new ActionService();

  try {
    const replyAction = await service.createPendingAction({
      userId: a.userId,
      conversationId: a.conversationId,
      toolName: "reply_to_email",
      args: { messageId: "m1", body: "Sounds good." },
    });
    await service.confirmAction({
      userId: a.userId,
      actionId: replyAction.id,
      executor: createRegistryActionExecutor({ registry, ctx: testCtx(a.userId) }),
    });

    const reply = lastSentMime(state);
    assert(reply.headers.to === "jane@acme.com", "a reply goes to the original sender");
    assert(reply.headers.subject === "Re: Pricing", "a reply prefixes Re: once");
    assert(reply.headers["in-reply-to"] === "<root@acme.com>", "a reply sets In-Reply-To");
    const replyRaw = state.calls.find((call) => call.path === "/messages/send")!;
    assert(
      (replyRaw.body as { threadId?: string }).threadId === "t1",
      "a reply is threaded into the original Gmail conversation",
    );

    const forwardAction = await service.createPendingAction({
      userId: a.userId,
      conversationId: a.conversationId,
      toolName: "forward_email",
      args: { messageId: "m1", to: ["boss@acme.com"], body: "FYI" },
    });
    await service.confirmAction({
      userId: a.userId,
      actionId: forwardAction.id,
      executor: createRegistryActionExecutor({ registry, ctx: testCtx(a.userId) }),
    });

    const forward = lastSentMime(state);
    assert(forward.headers.to === "boss@acme.com", "a forward goes to the requested recipient");
    assert(forward.headers.subject === "Fwd: Pricing", "a forward prefixes Fwd:");
    assert(forward.text.includes("Forwarded message"), "a forward quotes the original");
    assert(forward.text.includes("Hello there"), "the quoted original body is present");
  } finally {
    await cleanup([a.userId]);
  }
}

async function runNoUnconfirmedSendTests(): Promise<void> {
  section("a side effect cannot run without a confirmed action");

  const state = createFakeGmail();
  const sends = testSendService(state);
  const tool = createSendEmailTool({ sender: sends });

  // Call execute directly, the way the confirm executor does, but with no
  // action identity in the context: it must refuse.
  let refused = false;
  try {
    await tool.execute(testCtx("phase3-direct"), {
      to: ["a@b.com"],
      subject: "Hi",
      body: "Hello",
    });
  } catch {
    refused = true;
  }
  assert(refused, "the send tool refuses without a confirmed-action idempotency key");
  assert(sendCount(state) === 0, "no provider call happens without a confirmed action");

  // Rate limiting is enforced before the provider is touched.
  const limited = new SendService({
    send: (input) => sendEmail({ ...input, transport: createFakeTransport(state) }),
    getProfile: async () => ({ emailAddress: "me@example.com", messagesTotal: 0 }),
    allowSend: async () => false,
  });
  let rateLimited = false;
  try {
    await limited.sendMessage({
      userId: "phase3-limited",
      idempotencyKey: "k1",
      to: ["a@b.com"],
      subject: "Hi",
      body: "Hello",
    });
  } catch {
    rateLimited = true;
  }
  assert(rateLimited && sendCount(state) === 0, "a rate-limited send never reaches the provider");
}

async function runAutonomyTests(): Promise<void> {
  section("autopilot is an explicit opt-in; confirmation is the default");

  assert(
    decideToolPermission(
      testCtx("u", { allowAutonomousSideEffects: true, autonomy: "copilot" }),
      { name: "send_email", risk: "EXTERNAL_SIDE_EFFECT" },
    ).kind === "require_confirmation",
    "autonomous side effects need autonomy=autopilot",
  );
  assert(
    decideToolPermission(
      testCtx("u", { allowAutonomousSideEffects: false, autonomy: "autopilot" }),
      { name: "send_email", risk: "EXTERNAL_SIDE_EFFECT" },
    ).kind === "require_confirmation",
    "autonomy=autopilot alone does not bypass confirmation without the explicit flag",
  );
  assert(
    decideToolPermission(
      testCtx("u", { allowAutonomousSideEffects: true, autonomy: "autopilot" }),
      { name: "send_email", risk: "EXTERNAL_SIDE_EFFECT" },
    ).kind === "allow",
    "the explicit flag plus autopilot is the only autonomous path",
  );
}

// --------------------------------------------------------------------------
// Sanity: the generic machinery still works with a synthetic tool
// --------------------------------------------------------------------------

async function runSyntheticToolTest(): Promise<void> {
  section("the confirmation contract is tool-agnostic");

  let executed = false;
  const synthetic = defineTool({
    name: "delete_email",
    description: "Delete an email.",
    risk: "EXTERNAL_SIDE_EFFECT" as const,
    inputSchema: z.object({ messageId: z.string().min(1) }),
    async execute() {
      executed = true;
      return { deleted: true };
    },
  });
  const tools = buildToolSet({
    ctx: testCtx("phase3-synthetic"),
    registry: createToolRegistry([synthetic]),
    events: () => {},
    getStep: () => 1,
    onConfirmationRequired: async () => ({
      status: "confirmation_required",
      pendingActionId: "synthetic_1",
      tool: "delete_email",
      expiresAt: new Date().toISOString(),
      notice: "confirm",
    }),
  });
  const output = (await executable(tools, "delete_email").execute(
    { messageId: "m1" },
    { toolCallId: "c_syn" },
  )) as { status?: string };
  assert(output.status === "confirmation_required", "any EXTERNAL_SIDE_EFFECT tool defers to confirmation");
  assert(executed === false, "the synthetic side effect never ran");
}

async function main(): Promise<void> {
  runHashTests();
  runRegistryTests();
  runSchemaTests();
  await runLoopPolicyTests();
  await runActionLifecycleTests();
  await runConcurrencyTests();
  await runRegistryExecutorSendTests();
  await runReplyForwardTests();
  await runNoUnconfirmedSendTests();
  await runAutonomyTests();
  await runSyntheticToolTest();

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll Phase 3 (confirmation + send) checks passed.");
  process.exit(0);
}

main().catch((error) => {
  console.error("\nAgent Phase 3 test run failed:", error);
  process.exit(1);
});
