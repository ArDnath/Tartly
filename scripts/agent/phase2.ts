import "dotenv/config";

import type { AgentContext } from "../../lib/agent/context";
import { ConflictError, NotFoundError, ValidationError } from "../../lib/agent/errors";
import { buildToolSet } from "../../lib/agent/loop";
import { decideToolPermission } from "../../lib/agent/permissions";
import { createToolRegistry } from "../../lib/agent/registry";
import { READ_TOOLS, WRITE_TOOLS } from "../../lib/agent/tools";
import { createArchiveEmailTool } from "../../lib/agent/tools/archive-email";
import { createCreateDraftTool } from "../../lib/agent/tools/create-draft";
import { createSearchEmailsTool } from "../../lib/agent/tools/search-emails";
import { createStarEmailTool } from "../../lib/agent/tools/star-email";
import { createUpdateDraftTool } from "../../lib/agent/tools/update-draft";
import type { GmailTransport } from "../../lib/gmail/client";
import { toBase64Url } from "../../lib/gmail/mime";
import { decodeBase64Url } from "../../lib/gmail/parse";
import { createGmailEmailProvider } from "../../lib/providers/email/gmail-provider";
import { emptyTrash as gmailEmptyTrash } from "../../lib/mail/service";
import { EmailService } from "../../lib/services/email-service";
import {
  DraftService,
  MAX_DRAFT_BODY_CHARS,
  MAX_DRAFT_RECIPIENTS,
} from "../../lib/services/draft-service";

/**
 * Phase 2 (brief Phase 6) tests: the WRITE tool layer.
 *
 * Adversarial first. These assert safety and data-integrity invariants, never
 * model prose:
 *   - reversible mailbox mutations run without confirmation, and only with
 *     write permission;
 *   - a denied or malformed write never reaches the provider;
 *   - drafts are owner-scoped and optimistically concurrent (stale version →
 *     ConflictError, with no silent overwrite);
 *   - the Gmail mapping issues the right REST calls (labels, drafts);
 *   - a write is observable through a subsequent read;
 *   - no side-effect tool ships in this phase.
 *
 * Everything runs against an in-memory Gmail transport — no network needed.
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
  userId = "agent-phase2-user",
  overrides: Partial<AgentContext["permissions"]> = {},
): AgentContext {
  return {
    userId,
    conversationId: "test-conversation",
    requestId: "test-request",
    permissions: {
      canRead: true,
      canWrite: true,
      canSend: false,
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
// In-memory Gmail fake
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

type FakeDraft = { id: string; message: FakeMessage };
type FakeLabel = { id: string; name: string; type: "user" };

interface FakeGmail {
  messages: Map<string, FakeMessage>;
  drafts: Map<string, FakeDraft>;
  labels: Map<string, FakeLabel>;
  calls: Array<{ method: string; path: string; body?: unknown }>;
  seq: number;
}

function createFakeGmail(): FakeGmail {
  return {
    messages: new Map(),
    drafts: new Map(),
    labels: new Map(),
    calls: [],
    seq: 0,
  };
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
    ],
    body: "Hello there",
    internalDate: "1000",
    historyId: "1",
    ...overrides,
  };
}

/** Parses the single-part MIME `buildRawMessage` produces (test-only). */
function parseOurRaw(raw: string): {
  headers: Record<string, string>;
  text: string;
} {
  const mime = decodeBase64Url(raw);
  const separator = mime.indexOf("\r\n\r\n");
  const head = separator >= 0 ? mime.slice(0, separator) : mime;
  const encodedBody = separator >= 0 ? mime.slice(separator + 4).trim() : "";

  const headers: Record<string, string> = {};
  for (const line of head.split("\r\n")) {
    const index = line.indexOf(": ");
    if (index > 0) headers[line.slice(0, index).toLowerCase()] = line.slice(index + 2);
  }
  return { headers, text: encodedBody ? decodeBase64Url(encodedBody) : "" };
}

function nextMessage(
  state: FakeGmail,
  id: string,
  parsed: { headers: Record<string, string>; text: string },
  threadId?: string,
): FakeMessage {
  state.seq += 1;
  return {
    id,
    threadId: threadId ?? `thread_${id}`,
    labelIds: ["DRAFT"],
    headers: Object.entries(parsed.headers).map(([name, value]) => ({ name, value })),
    body: parsed.text,
    // A monotonic clock guarantees every mutation yields a new version token,
    // mirroring Gmail replacing the draft's inner message on update.
    internalDate: String(state.seq * 1_000),
    historyId: String(state.seq),
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

function draftResource(draft: FakeDraft) {
  return { id: draft.id, message: messageResource(draft.message) };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function notFound(): Response {
  return json({ error: { code: 404, message: "Not Found" } }, 404);
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
    const params = url.searchParams;

    if (pathname === "/profile" && method === "GET") {
      return json({ emailAddress: "me@example.com", messagesTotal: state.messages.size });
    }

    if (pathname === "/labels" && method === "GET") {
      return json({ labels: [...state.labels.values()] });
    }

    if (pathname === "/labels" && method === "POST") {
      const { name } = JSON.parse(String(init?.body)) as { name: string };
      const existing = [...state.labels.values()].find(
        (label) => label.name.toLowerCase() === name.toLowerCase(),
      );
      if (existing) return json(existing);
      const label: FakeLabel = { id: `Label_${name}`, name, type: "user" };
      state.labels.set(name.toLowerCase(), label);
      return json(label);
    }

    if (pathname === "/messages/batchModify" && method === "POST") {
      const { ids, addLabelIds, removeLabelIds } = JSON.parse(String(init?.body)) as {
        ids: string[];
        addLabelIds?: string[];
        removeLabelIds?: string[];
      };
      for (const id of ids ?? []) {
        const message = state.messages.get(id);
        if (!message) continue;
        message.labelIds = message.labelIds.filter(
          (label) => !(removeLabelIds ?? []).includes(label),
        );
        for (const label of addLabelIds ?? []) {
          if (!message.labelIds.includes(label)) message.labelIds.push(label);
        }
      }
      return new Response(null, { status: 204 });
    }

    if (pathname === "/messages/batchDelete" && method === "POST") {
      const { ids } = JSON.parse(String(init?.body)) as { ids: string[] };
      for (const id of ids ?? []) state.messages.delete(id);
      return new Response(null, { status: 204 });
    }

    if (pathname === "/messages" && method === "GET") {
      const labelIds = params.getAll("labelIds");
      const trashOnly = params.get("q") === "in:trash";
      const messages = [...state.messages.values()].filter(
        (message) =>
          labelIds.every((label) => message.labelIds.includes(label)) &&
          (!trashOnly || message.labelIds.includes("TRASH")),
      );
      return json({ messages: messages.map((message) => ({ id: message.id })), nextPageToken: null });
    }

    if (pathname.startsWith("/messages/") && method === "GET") {
      const id = pathname.slice("/messages/".length);
      const message = state.messages.get(id);
      return message ? json(messageResource(message)) : notFound();
    }

    if (pathname === "/drafts" && method === "POST") {
      const { message } = JSON.parse(String(init?.body)) as {
        message: { raw: string; threadId?: string };
      };
      const id = `draft_${++state.seq}`;
      const draft: FakeDraft = {
        id,
        message: nextMessage(state, `msg_${id}`, parseOurRaw(message.raw), message.threadId),
      };
      state.drafts.set(id, draft);
      return json(draftResource(draft));
    }

    if (pathname === "/drafts" && method === "GET") {
      return json({
        drafts: [...state.drafts.values()].map((draft) => ({
          id: draft.id,
          message: { id: draft.message.id, threadId: draft.message.threadId },
        })),
        nextPageToken: null,
      });
    }

    if (pathname.startsWith("/drafts/") && method === "GET") {
      const id = pathname.slice("/drafts/".length);
      const draft = state.drafts.get(id);
      return draft ? json(draftResource(draft)) : notFound();
    }

    if (pathname.startsWith("/drafts/") && method === "PUT") {
      const id = pathname.slice("/drafts/".length);
      const draft = state.drafts.get(id);
      if (!draft) return notFound();
      const { message } = JSON.parse(String(init?.body)) as {
        message: { raw: string; threadId?: string };
      };
      draft.message = nextMessage(
        state,
        draft.message.id,
        parseOurRaw(message.raw),
        message.threadId ?? draft.message.threadId,
      );
      return json(draftResource(draft));
    }

    throw new Error(`Fake Gmail: unhandled ${method} ${path}`);
  };
}

// --------------------------------------------------------------------------
// Sections
// --------------------------------------------------------------------------

function runRegistryTests(): void {
  section("write tool registry (risk is fixed in code)");

  assert(WRITE_TOOLS.length >= 6, "Phase 6 registers the reversible WRITE tools");
  assert(
    WRITE_TOOLS.every((tool) => tool.risk === "WRITE"),
    "every write tool is classified WRITE",
  );
  assert(
    READ_TOOLS.every((tool) => tool.risk === "READ"),
    "read tools remain READ risk",
  );
  assert(
    [...READ_TOOLS, ...WRITE_TOOLS].every((tool) => tool.risk !== "EXTERNAL_SIDE_EFFECT"),
    "no external-side-effect tool is registered in Phase 6",
  );

  const mutating = ["create_draft", "update_draft", "add_label", "remove_label", "archive_email", "mark_email_read", "star_email"];
  assert(
    mutating.every((name) => WRITE_TOOLS.some((tool) => tool.name === name)),
    "all reversible mailbox mutations are registered",
  );
}

function runSchemaTests(): void {
  section("write tool input validation (adversarial)");

  const createDraft = WRITE_TOOLS.find((tool) => tool.name === "create_draft")!;
  const updateDraft = WRITE_TOOLS.find((tool) => tool.name === "update_draft")!;
  const addLabel = WRITE_TOOLS.find((tool) => tool.name === "add_label")!;
  const removeLabel = WRITE_TOOLS.find((tool) => tool.name === "remove_label")!;
  const archive = WRITE_TOOLS.find((tool) => tool.name === "archive_email")!;
  const markRead = WRITE_TOOLS.find((tool) => tool.name === "mark_email_read")!;

  assert(
    !createDraft.inputSchema.safeParse({ to: [], body: "hi" }).success,
    "create_draft requires at least one recipient",
  );
  assert(
    !createDraft.inputSchema.safeParse({ to: ["not-an-email"], body: "hi" }).success,
    "create_draft rejects a malformed recipient",
  );
  assert(
    !createDraft.inputSchema.safeParse({ to: ["a@b.com"], body: "" }).success,
    "create_draft rejects an empty body",
  );
  assert(
    !createDraft.inputSchema.safeParse({ to: ["a@b.com"], body: "x".repeat(MAX_DRAFT_BODY_CHARS + 1) })
      .success,
    "create_draft rejects an over-long body",
  );
  assert(
    createDraft.inputSchema.safeParse({ to: ["a@b.com"], subject: "Hi", body: "Hello" }).success,
    "create_draft accepts a valid draft",
  );

  assert(
    !updateDraft.inputSchema.safeParse({ draftId: "d1" }).success,
    "update_draft requires at least one field to change",
  );
  assert(
    updateDraft.inputSchema.safeParse({ draftId: "d1", body: "New" }).success,
    "update_draft accepts a partial patch",
  );

  assert(
    !addLabel.inputSchema.safeParse({ messageId: "m1", label: "" }).success,
    "add_label rejects an empty label",
  );
  assert(
    !removeLabel.inputSchema.safeParse({ messageId: "" , label: "x" }).success,
    "remove_label rejects an empty message id",
  );
  assert(
    !archive.inputSchema.safeParse({ messageId: "" }).success,
    "archive_email rejects an empty message id",
  );
  assert(
    markRead.inputSchema.safeParse({ messageId: "m1", read: false }).success,
    "mark_email_read accepts an explicit read flag",
  );
}

async function runPermissionTests(): Promise<void> {
  section("permission engine + execution policy");

  assert(
    decideToolPermission(testCtx(), { name: "archive_email", risk: "WRITE" }).kind === "allow",
    "WRITE is allowed when the account can write",
  );
  assert(
    decideToolPermission(testCtx("u", { canWrite: false }), { name: "archive_email", risk: "WRITE" })
      .kind === "deny",
    "WRITE is denied when the account cannot write",
  );

  const allowState = createFakeGmail();
  allowState.messages.set("m1", fakeMessage());
  const allowEmail = new EmailService(createGmailEmailProvider(createFakeTransport(allowState)));
  const allowTools = buildToolSet({
    ctx: testCtx("phase2-allow"),
    registry: createToolRegistry([createArchiveEmailTool({ email: allowEmail })]),
    events: () => {},
    getStep: () => 1,
  });
  const output = (await executable(allowTools, "archive_email").execute(
    { messageId: "m1" },
    { toolCallId: "call_allow" },
  )) as { archived?: boolean; messageId?: string };
  assert(output.archived === true && output.messageId === "m1", "an allowed WRITE tool executes and returns a result");
  assert(
    allowState.calls.some((call) => call.path === "/messages/batchModify"),
    "an allowed WRITE tool reaches the provider",
  );

  const denyState = createFakeGmail();
  const denyEmail = new EmailService(createGmailEmailProvider(createFakeTransport(denyState)));
  const denyTools = buildToolSet({
    ctx: testCtx("phase2-deny", { canWrite: false }),
    registry: createToolRegistry([createArchiveEmailTool({ email: denyEmail })]),
    events: () => {},
    getStep: () => 1,
  });
  let denied = false;
  try {
    await executable(denyTools, "archive_email").execute({ messageId: "m1" }, { toolCallId: "call_deny" });
  } catch {
    denied = true;
  }
  assert(denied, "a denied WRITE tool throws");
  assert(denyState.calls.length === 0, "a denied WRITE tool never reaches the provider");

  const invalidState = createFakeGmail();
  const invalidEmail = new EmailService(createGmailEmailProvider(createFakeTransport(invalidState)));
  const invalidTools = buildToolSet({
    ctx: testCtx("phase2-invalid"),
    registry: createToolRegistry([createArchiveEmailTool({ email: invalidEmail })]),
    events: () => {},
    getStep: () => 1,
  });
  let rejected = false;
  try {
    await executable(invalidTools, "archive_email").execute({ messageId: "" }, { toolCallId: "call_invalid" });
  } catch {
    rejected = true;
  }
  assert(rejected, "invalid write input is rejected");
  assert(invalidState.calls.length === 0, "invalid write input never reaches the provider");
}

async function runDraftServiceTests(): Promise<void> {
  section("draft service business rules");

  const user = "phase2-drafts";
  const state = createFakeGmail();
  const drafts = new DraftService(createGmailEmailProvider(createFakeTransport(state)));

  const created = await drafts.createDraft({
    userId: user,
    to: ["A@Example.com", "a@example.com"],
    subject: "  Hi there  ",
    body: "Hello",
  });
  assert(created.id.length > 0, "create_draft returns a draft id");
  assert(created.version.length > 0, "create_draft returns a concurrency version");
  assert(created.to.length === 1 && created.to[0] === "a@example.com", "recipients are normalized and de-duplicated");
  assert(created.subject === "Hi there", "the subject is trimmed");

  const reread = await drafts.getDraft({ userId: user, draftId: created.id });
  assert(reread.version === created.version, "the version is stable across reads");

  let tooLong = false;
  try {
    await drafts.createDraft({
      userId: user,
      to: ["a@b.com"],
      body: "x".repeat(MAX_DRAFT_BODY_CHARS + 1),
    });
  } catch (error) {
    tooLong = error instanceof ValidationError;
  }
  assert(tooLong, "an over-long draft body is rejected");

  let tooMany = false;
  try {
    await drafts.createDraft({
      userId: user,
      to: Array.from({ length: MAX_DRAFT_RECIPIENTS + 1 }, (_, index) => `u${index}@x.com`),
      body: "hi",
    });
  } catch (error) {
    tooMany = error instanceof ValidationError;
  }
  assert(tooMany, "too many recipients are rejected");

  let badAddress = false;
  try {
    await drafts.createDraft({ userId: user, to: ["nope"], body: "hi" });
  } catch (error) {
    badAddress = error instanceof ValidationError;
  }
  assert(badAddress, "a malformed recipient is rejected by the service too");
}

async function runConcurrencyTests(): Promise<void> {
  section("draft optimistic concurrency (no silent overwrite)");

  const user = "phase2-concurrency";
  const state = createFakeGmail();
  const drafts = new DraftService(createGmailEmailProvider(createFakeTransport(state)));
  const created = await drafts.createDraft({
    userId: user,
    to: ["a@b.com"],
    subject: "Hi",
    body: "Original body",
  });

  let conflicted = false;
  try {
    await drafts.updateDraft({
      userId: user,
      draftId: created.id,
      expectedVersion: "stale-version",
      patch: { body: "Should not be written" },
    });
  } catch (error) {
    conflicted = error instanceof ConflictError;
  }
  assert(conflicted, "update_draft with a stale version throws ConflictError");
  assert(
    !state.calls.some((call) => call.method === "PUT"),
    "a rejected update never writes to Gmail",
  );

  const updated = await drafts.updateDraft({
    userId: user,
    draftId: created.id,
    expectedVersion: created.version,
    patch: { body: "Updated body" },
  });
  assert(updated.body === "Updated body", "update_draft applies the patch with the current version");
  assert(updated.subject === "Hi", "update_draft preserves fields that were not patched");
  assert(updated.to[0] === "a@b.com", "update_draft preserves recipients that were not patched");
  assert(updated.version !== created.version, "update_draft returns a new version");
}

async function runNotFoundTests(): Promise<void> {
  section("owner scoping / missing draft");

  const state = createFakeGmail();
  const drafts = new DraftService(createGmailEmailProvider(createFakeTransport(state)));

  let missing = false;
  try {
    await drafts.updateDraft({ userId: "phase2-missing", draftId: "draft_of_someone_else", patch: { body: "x" } });
  } catch (error) {
    missing = error instanceof NotFoundError;
  }
  assert(missing, "updating another user's/missing draft throws NotFoundError");
}

async function runMailboxMutationTests(): Promise<void> {
  section("mailbox mutations map to the right Gmail calls");

  const user = "phase2-mailbox";
  const state = createFakeGmail();
  state.messages.set("m1", fakeMessage());
  const email = new EmailService(createGmailEmailProvider(createFakeTransport(state)));

  await email.archiveMessage({ userId: user, messageId: "m1" });
  const archiveCall = state.calls.at(-1)!;
  const archiveBody = archiveCall.body as { ids: string[]; removeLabelIds: string[] };
  assert(archiveCall.path === "/messages/batchModify", "archive uses messages.batchModify");
  assert(archiveBody.ids.includes("m1") && archiveBody.removeLabelIds.includes("INBOX"), "archive removes INBOX");
  assert(!state.messages.get("m1")!.labelIds.includes("INBOX"), "archive is reflected in mailbox state");

  await email.markRead({ userId: user, messageId: "m1", read: false });
  const readBody = state.calls.at(-1)!.body as { addLabelIds: string[] };
  assert(readBody.addLabelIds.includes("UNREAD"), "mark_email_read(false) adds UNREAD");

  await email.markRead({ userId: user, messageId: "m1", read: true });
  const unreadBody = state.calls.at(-1)!.body as { removeLabelIds: string[] };
  assert(unreadBody.removeLabelIds.includes("UNREAD"), "mark_email_read(true) removes UNREAD");

  await email.starMessage({ userId: user, messageId: "m1", starred: true });
  const starBody = state.calls.at(-1)!.body as { addLabelIds: string[] };
  assert(starBody.addLabelIds.includes("STARRED"), "star_email(true) adds STARRED");
  assert(state.messages.get("m1")!.labelIds.includes("STARRED"), "starring is reflected in mailbox state");

  await email.starMessage({ userId: user, messageId: "m1", starred: false });
  const unstarBody = state.calls.at(-1)!.body as { removeLabelIds: string[] };
  assert(unstarBody.removeLabelIds.includes("STARRED"), "star_email(false) removes STARRED");

  await email.addLabel({ userId: user, messageId: "m1", label: "Investors" });
  assert(
    state.calls.some((call) => call.path === "/labels" && call.method === "POST"),
    "add_label creates a label that does not exist",
  );
  assert(state.messages.get("m1")!.labelIds.includes("Label_Investors"), "add_label applies the new label");

  const beforeRemove = state.calls.length;
  await email.removeLabel({ userId: user, messageId: "m1", label: "Nonexistent" });
  const removeCalls = state.calls.slice(beforeRemove);
  assert(
    !removeCalls.some((call) => call.path === "/labels" && call.method === "POST"),
    "remove_label does not create a missing label",
  );
  assert(
    !removeCalls.some((call) => call.path === "/messages/batchModify"),
    "remove_label of a missing label issues no mutation",
  );

  await email.removeLabel({ userId: user, messageId: "m1", label: "Investors" });
  assert(!state.messages.get("m1")!.labelIds.includes("Label_Investors"), "remove_label removes an existing label");
}

async function runStarToolTests(): Promise<void> {
  section("star_email stars a message through the tool layer");

  const user = "phase2-star-tool";
  const state = createFakeGmail();
  state.messages.set("m1", fakeMessage());
  const email = new EmailService(createGmailEmailProvider(createFakeTransport(state)));

  const tools = buildToolSet({
    ctx: testCtx(user),
    registry: createToolRegistry([
      createStarEmailTool({ email }),
      createSearchEmailsTool({ email }),
    ]),
    events: () => {},
    getStep: () => 1,
  });

  const starred = (await executable(tools, "star_email").execute(
    { messageId: "m1" },
    { toolCallId: "star" },
  )) as { starred?: boolean; notice?: string };
  assert(starred.starred === true, "star_email defaults to starring the message");
  assert(state.messages.get("m1")!.labelIds.includes("STARRED"), "star_email applies the STARRED label");

  const readBack = (await executable(tools, "search_emails").execute(
    { box: "inbox" },
    { toolCallId: "read_starred" },
  )) as { messages: Array<{ starred?: boolean }> };
  assert(readBack.messages[0]?.starred === true, "the star is observable through search_emails");
}

async function runDeleteForeverTests(): Promise<void> {
  section("permanent delete bypasses the trash");

  const user = "phase2-delete-forever";
  const state = createFakeGmail();
  state.messages.set("m1", fakeMessage());
  state.messages.set(
    "m2",
    fakeMessage({ id: "m2", threadId: "t2", labelIds: ["TRASH"] }),
  );
  state.messages.set(
    "m3",
    fakeMessage({ id: "m3", threadId: "t3", labelIds: ["INBOX"] }),
  );
  const email = new EmailService(createGmailEmailProvider(createFakeTransport(state)));

  await email.deleteMessageForever({ userId: user, messageId: "m1" });
  const deleteCall = state.calls.at(-1)!;
  assert(
    deleteCall.path === "/messages/batchDelete",
    "deleteMessageForever uses messages.batchDelete",
  );
  assert(!state.messages.has("m1"), "permanent delete removes the message outright");

  const removed = await gmailEmptyTrash(user, createFakeTransport(state));
  assert(removed === 1, "emptyTrash deletes exactly the trashed messages");
  assert(!state.messages.has("m2"), "emptyTrash permanently deletes the trash");
  assert(state.messages.has("m3"), "emptyTrash leaves non-trashed mail alone");
}

async function runWriteThenReadTests(): Promise<void> {
  section("a write is observable through a subsequent read");

  const user = "phase2-readback";
  const state = createFakeGmail();
  state.messages.set("m1", fakeMessage());
  const provider = createGmailEmailProvider(createFakeTransport(state));
  const email = new EmailService(provider);

  const tools = buildToolSet({
    ctx: testCtx(user),
    registry: createToolRegistry([
      createArchiveEmailTool({ email }),
      createSearchEmailsTool({ email }),
    ]),
    events: () => {},
    getStep: () => 1,
  });

  const before = (await executable(tools, "search_emails").execute(
    { box: "inbox" },
    { toolCallId: "read_before" },
  )) as { messages: unknown[] };
  assert(before.messages.length === 1, "the message is in the inbox before archiving");

  await executable(tools, "archive_email").execute({ messageId: "m1" }, { toolCallId: "archive" });

  const after = (await executable(tools, "search_emails").execute(
    { box: "inbox" },
    { toolCallId: "read_after" },
  )) as { messages: unknown[] };
  assert(after.messages.length === 0, "search_emails no longer lists the archived message");
}

async function runDraftToolTests(): Promise<void> {
  section("draft tools execute end to end through the loop");

  const user = "phase2-draft-tools";
  const state = createFakeGmail();
  const drafts = new DraftService(createGmailEmailProvider(createFakeTransport(state)));

  const createTools = buildToolSet({
    ctx: testCtx(user),
    registry: createToolRegistry([createCreateDraftTool({ drafts })]),
    events: () => {},
    getStep: () => 1,
  });

  const created = (await executable(createTools, "create_draft").execute(
    { to: ["Jane <jane@acme.com>"], subject: "Hello", body: "Draft body" },
    { toolCallId: "draft_create" },
  )) as { draftId?: string; version?: string; to?: string[] };

  assert(typeof created.draftId === "string" && created.draftId.length > 0, "create_draft returns a draft id");
  assert(typeof created.version === "string" && created.version.length > 0, "create_draft returns a version");
  assert(
    Array.isArray(created.to) && created.to[0] === "jane@acme.com",
    "create_draft normalizes a Name <address> recipient",
  );

  const updateTools = buildToolSet({
    ctx: testCtx(user),
    registry: createToolRegistry([createUpdateDraftTool({ drafts })]),
    events: () => {},
    getStep: () => 1,
  });

  const updated = (await executable(updateTools, "update_draft").execute(
    { draftId: created.draftId, expectedVersion: created.version, body: "Rewritten body" },
    { toolCallId: "draft_update" },
  )) as { draftId?: string; version?: string; bodyPreview?: string };

  assert(updated.draftId === created.draftId, "update_draft keeps the same draft id");
  assert(updated.version !== created.version, "update_draft returns a new version");
  assert(
    typeof updated.bodyPreview === "string" && updated.bodyPreview.includes("Rewritten"),
    "update_draft returns the new body",
  );
}

async function main(): Promise<void> {
  runRegistryTests();
  runSchemaTests();
  await runPermissionTests();
  await runDraftServiceTests();
  await runConcurrencyTests();
  await runNotFoundTests();
  await runMailboxMutationTests();
  await runStarToolTests();
  await runDeleteForeverTests();
  await runWriteThenReadTests();
  await runDraftToolTests();

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll Phase 2 (WRITE tools) checks passed.");
  process.exit(0);
}

main().catch((error) => {
  console.error("\nAgent Phase 2 test run failed:", error);
  process.exit(1);
});
