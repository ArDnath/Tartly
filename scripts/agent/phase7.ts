import "dotenv/config";

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

import { eq } from "drizzle-orm";

import { encodeSse, type AgentRealtimeEvent } from "../../lib/agent/realtime";
import { createChatThread } from "../../lib/ai/chat-service";
import { db, pool } from "../../lib/db";
import { mailboxes, threads, user } from "../../lib/db/schema";
import { listThreadActivitySince } from "../../lib/email-operator/activity";
import { ActionService } from "../../lib/services/action-service";

/**
 * Phase 7 tests (brief Phases 11–12): sync independence + realtime.
 *
 * Two guarantees:
 *   - **Sync independence.** The `/assistant` server render must not reach any
 *     Gmail, queue, engine or research module. This walks the server module
 *     graph from the page and fails if a forbidden module appears, so the
 *     regression is caught before it ships.
 *   - **Realtime.** The action-update cursor returns only the caller's changed
 *     actions, and SSE encoding is well-formed.
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

const ROOT = process.cwd();

// --------------------------------------------------------------------------
// Server module graph (static regression guard)
// --------------------------------------------------------------------------

const FORBIDDEN = [
  "lib/gmail/",
  "lib/mail/service",
  "lib/providers/",
  "lib/email-operator/",
  "lib/queue/",
  "lib/engine/",
  "lib/research/",
  "lib/services/",
];

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = join(ROOT, specifier.slice(2));
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    base = normalize(join(dirname(fromFile), specifier));
  } else {
    return null; // package import
  }

  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => `${base}${ext}`),
    ...EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  return (
    candidates.find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    ) ?? null
  );
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /(?:^|\n)\s*import\s+[^'"]*from\s+['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s+[^'"]*from\s+['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function collectServerGraph(entry: string): string[] {
  const visited = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);

    const source = readFileSync(file, "utf8");
    // A client component runs in the browser, not on the critical server path.
    if (/^\s*["']use client["']/.test(source)) continue;

    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveSpecifier(file, specifier);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return [...visited];
}

function runSyncIndependenceTests(): void {
  section("/assistant server render never reaches Gmail, the queue or the engine");

  const graph = collectServerGraph(join(ROOT, "app/assistant/page.tsx"));
  const graphRelative = graph.map((file) => relative(ROOT, file));

  assert(graphRelative.length > 3, "the page graph was resolved");
  assert(
    graphRelative.some((file) => file === "lib/db/index.ts"),
    "the page reads from the database (its state source)",
  );

  for (const forbidden of FORBIDDEN) {
    const hit = graphRelative.find((file) => file.includes(forbidden));
    assert(!hit, `the page never imports ${forbidden}${hit ? ` (via ${hit})` : ""}`);
  }
}

// --------------------------------------------------------------------------
// Realtime cursor
// --------------------------------------------------------------------------

let seq = 0;
async function makeUserWithThread(): Promise<{ userId: string; conversationId: string }> {
  seq += 1;
  const userId = `agent-phase7-${Date.now()}-${seq}`;
  await db.insert(user).values({ id: userId, name: "P7", email: `${userId}@example.com` });
  const thread = await createChatThread(userId);
  return { userId, conversationId: thread.id };
}

/** A user with one mirrored mail thread, for the new-mail activity cursor. */
async function makeUserWithMirrorThread(): Promise<{
  userId: string;
  gmailThreadId: string;
}> {
  seq += 1;
  const userId = `agent-phase7-mail-${Date.now()}-${seq}`;
  const mailboxId = `mb_${userId}`;
  const gmailThreadId = `gt_${userId}`;
  await db.insert(user).values({ id: userId, name: "P7", email: `${userId}@example.com` });
  await db.insert(mailboxes).values({ id: mailboxId, userId, email: `${userId}@example.com` });
  await db.insert(threads).values({
    id: `th_${userId}`,
    mailboxId,
    userId,
    gmailThreadId,
    subject: "New mail",
    lastMessageAt: new Date(),
    isUnread: true,
  });
  return { userId, gmailThreadId };
}

async function cleanup(users: string[]): Promise<void> {
  for (const id of users) await db.delete(user).where(eq(user.id, id));
}

async function runRealtimeTests(): Promise<void> {
  section("the realtime cursor returns only the caller's changed actions");

  const a = await makeUserWithThread();
  const b = await makeUserWithThread();
  const service = new ActionService();

  try {
    const before = new Date(Date.now() - 1_000);
    const action = await service.createPendingAction({
      userId: a.userId,
      conversationId: a.conversationId,
      toolName: "send_email",
      args: { to: ["jane@acme.com"], subject: "Hi", body: "Hello" },
    });
    assert(action.updatedAt > before, "a created action is newer than the cursor");

    const seen = await service.listUpdatedSince({ userId: a.userId, since: before });
    assert(
      seen.some((row) => row.id === action.id),
      "a created action appears in the cursor",
    );

    const bSeen = await service.listUpdatedSince({ userId: b.userId, since: before });
    assert(bSeen.length === 0, "another user's cursor is empty (owner-scoped)");

    // Confirm: the transition must move `updatedAt` so the client is notified.
    const cursor = new Date();
    await service.confirmAction({
      userId: a.userId,
      actionId: action.id,
      executor: async () => ({ sent: true }),
    });
    const afterConfirm = await service.listUpdatedSince({
      userId: a.userId,
      since: cursor,
    });
    const updated = afterConfirm.find((row) => row.id === action.id);
    assert(updated?.status === "SUCCEEDED", "a confirm is visible through the cursor");

    // SSE framing is parseable and names the event.
    const event: AgentRealtimeEvent = {
      type: "action.updated",
      at: new Date().toISOString(),
      action: {
        ...updated!,
        arguments: updated!.arguments,
        expiresAt: updated!.expiresAt.toISOString(),
        confirmedAt: updated!.confirmedAt?.toISOString() ?? null,
        executedAt: updated!.executedAt?.toISOString() ?? null,
        createdAt: updated!.createdAt.toISOString(),
      } as never,
    };
    const frame = encodeSse(event);
    assert(frame.startsWith("event: action.updated\n"), "the SSE frame names the event");
    const dataLine = frame
      .split("\n")
      .find((line) => line.startsWith("data: "));
    assert(Boolean(dataLine), "the SSE frame carries data");
    const parsed = JSON.parse(dataLine!.slice("data: ".length)) as { action?: { id?: string } };
    assert(parsed.action?.id === action.id, "the SSE payload round-trips the action");
  } finally {
    await cleanup([a.userId, b.userId]);
  }
}

async function runMailActivityTests(): Promise<void> {
  section("the new-mail activity cursor is owner-scoped");

  const a = await makeUserWithMirrorThread();
  const b = await makeUserWithMirrorThread();

  try {
    const before = new Date(Date.now() - 5_000);
    const activity = await listThreadActivitySince({ userId: a.userId, since: before });
    assert(
      activity.length === 1 && activity[0]!.gmailThreadId === a.gmailThreadId,
      "a synced thread appears in the mail activity feed",
    );

    const other = await listThreadActivitySince({ userId: b.userId, since: before });
    assert(other.length === 1, "the other user only sees their own thread");

    // A thread older than the cursor is not re-sent.
    const quiet = await listThreadActivitySince({ userId: a.userId, since: new Date() });
    assert(quiet.length === 0, "nothing is emitted when the thread has not advanced");

    const frame = encodeSse({
      type: "mail.updated",
      at: new Date().toISOString(),
      thread: {
        id: activity[0]!.id,
        gmailThreadId: activity[0]!.gmailThreadId,
        subject: activity[0]!.subject,
        lastMessageAt: activity[0]!.lastMessageAt?.toISOString() ?? null,
        isUnread: activity[0]!.isUnread,
      },
    });
    assert(frame.startsWith("event: mail.updated\n"), "the mail SSE frame names the event");
  } finally {
    await cleanup([a.userId, b.userId]);
  }
}

async function main(): Promise<void> {
  runSyncIndependenceTests();
  await runRealtimeTests();
  await runMailActivityTests();

  await pool.end().catch(() => {});

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll Phase 7 (sync independence + realtime) checks passed.");
  process.exit(0);
}

main().catch((error) => {
  console.error("\nAgent Phase 7 test run failed:", error);
  process.exit(1);
});
