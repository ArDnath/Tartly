import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { AgentChatRepository } from "@/lib/repositories/agent-chat";
import { AiCacheRepository } from "@/lib/repositories/ai-cache";
import { AssistantSettingsRepository } from "@/lib/repositories/assistant-settings";
import { AutomationRuleRepository } from "@/lib/repositories/automation-rules";
import { DigestRepository } from "@/lib/repositories/digests";
import { KnowledgeRepository } from "@/lib/repositories/knowledge";
import { MessageRepository } from "@/lib/repositories/messages";
import { ReplyMemoryRepository } from "@/lib/repositories/reply-memory";
import { SenderProfileRepository } from "@/lib/repositories/sender-profiles";
import { ThreadRepository } from "@/lib/repositories/threads";
import { UnsubscribeAttemptRepository } from "@/lib/repositories/unsubscribe-attempts";

/**
 * Integration suite for the C2 AI/domain repositories (SKILL §14.1). Real SQL
 * against an ephemeral Postgres with the production migrations, so unique
 * constraints, `DISTINCT ON`, upserts and owner scoping are exercised for real.
 */
let container: StartedPostgreSqlContainer;
let pool: Pool;
let database: Database;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  pool = new Pool({ connectionString: container.getConnectionUri(), max: 5 });
  database = drizzle(pool, { schema }) as unknown as Database;
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

beforeEach(async () => {
  await pool.query('truncate "user" cascade');
  await pool.query(
    `insert into "user" (id, name, email)
     values ('user-1','User One','user-1@test.local'),
            ('user-2','User Two','user-2@test.local')`,
  );
  await pool.query(
    `insert into mailboxes (id, user_id, email)
     values ('mb-1','user-1','me@test.local')`,
  );
});

async function seedThread(id: string, gmailThreadId: string, lastMessageAt?: Date) {
  await pool.query(
    `insert into threads (id, mailbox_id, user_id, gmail_thread_id, subject, last_message_at)
     values ($1,'mb-1','user-1',$2,$3,$4)`,
    [id, gmailThreadId, `Subject ${id}`, lastMessageAt ?? new Date()],
  );
}

async function seedMessage(input: {
  id: string;
  threadId: string;
  gmailMessageId: string;
  direction: string;
  fromAddr?: string;
  toAddr?: string[];
  bodyText?: string;
  snippet?: string;
  sentAt?: Date;
  unsubscribe?: unknown;
}) {
  await pool.query(
    `insert into messages
       (id, thread_id, gmail_message_id, direction, from_addr, to_addr, body_text, snippet, sent_at, unsubscribe)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb)`,
    [
      input.id,
      input.threadId,
      input.gmailMessageId,
      input.direction,
      input.fromAddr ?? null,
      JSON.stringify(input.toAddr ?? []),
      input.bodyText ?? null,
      input.snippet ?? null,
      input.sentAt ?? new Date(),
      input.unsubscribe ? JSON.stringify(input.unsubscribe) : null,
    ],
  );
}

describe("AiCacheRepository", () => {
  it("upserts by (user, type, key) and reads back the payload", async () => {
    const repo = new AiCacheRepository(database);
    await repo.upsert({
      id: "ac-1",
      userId: "user-1",
      cacheType: "thread-summary",
      cacheKey: "k1",
      payload: { summary: "first" },
      expiresAt: new Date(Date.now() + 60_000),
    });
    await repo.upsert({
      id: "ac-2",
      userId: "user-1",
      cacheType: "thread-summary",
      cacheKey: "k1",
      payload: { summary: "second" },
      expiresAt: new Date(Date.now() + 60_000),
    });
    const row = await repo.findEntry({
      userId: "user-1",
      type: "thread-summary",
      key: "k1",
    });
    expect(row?.payload).toEqual({ summary: "second" });
  });

  it("purges only expired rows", async () => {
    const repo = new AiCacheRepository(database);
    await repo.upsert({
      id: "ac-1",
      userId: "user-1",
      cacheType: "x",
      cacheKey: "old",
      payload: {},
      expiresAt: new Date(Date.now() - 60_000),
    });
    await repo.upsert({
      id: "ac-2",
      userId: "user-1",
      cacheType: "x",
      cacheKey: "new",
      payload: {},
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await repo.deleteExpired(new Date())).toBe(1);
  });
});

describe("ReplyMemoryRepository", () => {
  it("lists only active memories and archives owner-scoped", async () => {
    const repo = new ReplyMemoryRepository(database);
    await repo.insert({
      id: "rm-1",
      userId: "user-1",
      kind: "PREFERENCE",
      scopeType: "GLOBAL",
      scopeValue: "",
      content: "keep it short",
    });
    await repo.insert({
      id: "rm-2",
      userId: "user-1",
      kind: "FACT",
      scopeType: "SENDER",
      scopeValue: "a@b.com",
      content: "works there",
    });
    expect(await repo.countActive("user-1")).toBe(2);
    expect(await repo.archive({ userId: "user-2", memoryId: "rm-1", now: new Date() })).toBe(
      false,
    );
    expect(await repo.archive({ userId: "user-1", memoryId: "rm-1", now: new Date() })).toBe(
      true,
    );
    expect(await repo.countActive("user-1")).toBe(1);
    expect(await repo.countActive("user-2")).toBe(0);
  });
});

describe("KnowledgeRepository", () => {
  it("CRUDs knowledge entries owner-scoped", async () => {
    const repo = new KnowledgeRepository(database);
    await repo.insertEntry({ id: "ke-1", userId: "user-1", title: "Pricing", content: "$10" });
    expect(await repo.countEntries("user-1")).toBe(1);
    expect(
      await repo.updateEntry({
        userId: "user-2",
        id: "ke-1",
        title: "Hacked",
        now: new Date(),
      }),
    ).toBe(false);
    expect(
      await repo.updateEntry({ userId: "user-1", id: "ke-1", content: "$12", now: new Date() }),
    ).toBe(true);
    expect(await repo.deleteEntry({ userId: "user-1", id: "ke-1" })).toBe(true);
    expect(await repo.countEntries("user-1")).toBe(0);
  });

  it("CRUDs snippets owner-scoped", async () => {
    const repo = new KnowledgeRepository(database);
    await repo.insertSnippet({ id: "sn-1", userId: "user-1", shortcut: "sig", content: "-- A" });
    expect(await repo.countSnippets("user-1")).toBe(1);
    expect(await repo.deleteSnippet({ userId: "user-2", id: "sn-1" })).toBe(false);
    expect(await repo.deleteSnippet({ userId: "user-1", id: "sn-1" })).toBe(true);
  });
});

describe("AssistantSettingsRepository", () => {
  it("inserts defaults then upserts style", async () => {
    const repo = new AssistantSettingsRepository(database);
    expect(await repo.findByUser("user-1")).toBeUndefined();
    await repo.upsert({ values: { userId: "user-1" }, set: { updatedAt: new Date() } });
    const inserted = await repo.findByUser("user-1");
    expect(inserted?.briefingHour).toBe(8);

    await repo.upsertStyle({
      userId: "user-1",
      style: {
        typicalLength: "short",
        formality: "informal",
        commonGreeting: "hey",
        notableTraits: [],
        examples: [],
      },
      learnedWritingStyle: "guide",
      styleVersion: 1,
      analyzedAt: new Date(),
    });
    expect((await repo.findStyleAnalyzedAt("user-1"))?.analyzedAt).toBeInstanceOf(Date);
    expect((await repo.findByUser("user-1"))?.learnedWritingStyle).toBe("guide");
  });
});

describe("AutomationRuleRepository", () => {
  async function insertRule(id: string, name: string, priority: number) {
    await new AutomationRuleRepository(database).insertRule({
      id,
      userId: "user-1",
      name,
      condition: { logic: "AND", ai: null, from: null, to: null, subject: null, categories: [] },
      actions: [{ type: "ARCHIVE", fields: {} }],
      priority,
    });
  }

  it("lists rules by priority then update/delete owner-scoped", async () => {
    const repo = new AutomationRuleRepository(database);
    await insertRule("r-2", "Second", 200);
    await insertRule("r-1", "First", 10);
    const rules = await repo.listRules("user-1", 10);
    expect(rules.map((r) => r.id)).toEqual(["r-1", "r-2"]);
    expect(await repo.updateRule({ userId: "user-2", id: "r-1", patch: { name: "x" }, now: new Date() })).toBe(false);
    expect(await repo.updateRule({ userId: "user-1", id: "r-1", patch: { name: "Renamed" }, now: new Date() })).toBe(true);
    expect(await repo.deleteRule({ userId: "user-1", id: "r-2" })).toBe(true);
  });

  it("records and counts applied executions with the rule name", async () => {
    const repo = new AutomationRuleRepository(database);
    await insertRule("r-1", "First", 10);
    await repo.insertExecution({
      id: "re-1",
      userId: "user-1",
      ruleId: "r-1",
      status: "applied",
      reason: "matched",
      matchMetadata: {},
    });
    await repo.insertExecution({
      id: "re-2",
      userId: "user-1",
      ruleId: "r-1",
      status: "skipped",
      reason: "no match",
      matchMetadata: {},
    });
    expect(await repo.countAppliedSince("user-1", new Date(Date.now() - 60_000))).toBe(1);
    const rows = await repo.listExecutionsWithRuleName("user-1", 10);
    expect(rows[0]?.ruleName).toBe("First");
  });
});

describe("DigestRepository", () => {
  async function insertDigest(id: string, generatedAt: Date) {
    await new DigestRepository(database).insertDigest({
      id,
      userId: "user-1",
      kind: "daily",
      status: "ready",
      periodStart: new Date(generatedAt.getTime() - 86_400_000),
      periodEnd: generatedAt,
      headline: `h-${id}`,
      summary: "s",
      source: "heuristic",
      threadCount: 1,
      noiseCount: 0,
      generatedAt,
    });
  }

  it("keeps the newest N and returns latest with items ordered by priority", async () => {
    const repo = new DigestRepository(database);
    for (let i = 0; i < 7; i += 1) {
      await insertDigest(`d-${i}`, new Date(Date.now() - i * 60_000));
    }
    const keep = await repo.listRecentIds("user-1", 5);
    expect(keep).toHaveLength(5);
    await repo.deleteAllExcept("user-1", keep);
    expect(await repo.listRecentIds("user-1", 100)).toHaveLength(5);

    await seedThread("t-1", "g-1");
    await repo.insertItems([
      { id: "di-1", digestId: "d-0", userId: "user-1", threadId: "t-1", group: "needs_you", title: "low", priority: 1 },
      { id: "di-2", digestId: "d-0", userId: "user-1", threadId: "t-1", group: "waiting", title: "high", priority: 9 },
    ]);
    const latest = await repo.findLatest("user-1");
    expect(latest?.id).toBe("d-0");
    const items = await repo.listItems("d-0");
    expect(items[0]?.title).toBe("high");
  });
});

describe("AgentChatRepository", () => {
  it("dedupes workspace-setup inserts and filters archived threads", async () => {
    const repo = new AgentChatRepository(database);
    const first = await repo.insertThreadIfAbsent({ id: "ct-1", userId: "user-1", title: "T" });
    const second = await repo.insertThreadIfAbsent({ id: "ct-1", userId: "user-1", title: "T" });
    expect(first).toBeDefined();
    expect(second).toBeUndefined();

    await repo.insertThread({ id: "ct-2", userId: "user-1", title: "Archived" });
    await repo.setThreadArchived("user-1", "ct-2", true, new Date());
    const active = await repo.listThreads({ userId: "user-1", includeArchived: false });
    expect(active.map((t) => t.id)).toEqual(["ct-1"]);
    expect(await repo.listThreads({ userId: "user-1", includeArchived: true })).toHaveLength(2);
  });

  it("inserts a message and touches the thread timestamp", async () => {
    const repo = new AgentChatRepository(database);
    await repo.insertThread({ id: "ct-1", userId: "user-1" });
    await repo.insertMessage({
      id: "cm-1",
      threadId: "ct-1",
      role: "user",
      parts: [{ type: "text", text: "hi" }],
    });
    const when = new Date();
    await repo.touchThread("ct-1", when);
    const messages = await repo.listMessages("ct-1");
    expect(messages).toHaveLength(1);
    expect((await repo.findThreadById("ct-1"))?.lastMessageAt?.toISOString()).toBe(
      when.toISOString(),
    );
  });
});

describe("SenderProfileRepository", () => {
  async function upsert(email: string, category: schema.SenderCategory) {
    const repo = new SenderProfileRepository(database);
    return repo.upsert({
      values: { id: `sp-${email}`, userId: "user-1", email, category },
      set: { category },
    });
  }

  it("upserts, lists, categorises and unsubscribes owner-scoped", async () => {
    const repo = new SenderProfileRepository(database);
    await upsert("news@x.com", "Newsletters");
    await upsert("friend@x.com", "Personal");
    expect(await repo.list({ userId: "user-1", limit: 10 })).toHaveLength(2);
    expect(await repo.countByCategory("user-1")).toEqual(
      expect.arrayContaining([{ category: "Newsletters", total: 1 }]),
    );
    expect(
      await repo.listEmailsByCategories("user-1", ["Newsletters", "Marketing"]),
    ).toEqual(["news@x.com"]);
    expect(await repo.setStatus({ userId: "user-2", id: "sp-friend@x.com", status: "blocked", now: new Date() })).toBe(false);
    await repo.setUnsubscribe({
      userId: "user-1",
      email: "NEWS@x.com",
      url: "https://x.com/u",
      method: "one-click",
      now: new Date(),
    });
    expect((await repo.findByEmail("user-1", "news@x.com"))?.unsubscribeMethod).toBe("one-click");
  });
});

describe("UnsubscribeAttemptRepository", () => {
  it("appends an audit row", async () => {
    const repo = new UnsubscribeAttemptRepository(database);
    await repo.insert({
      id: "ua-1",
      userId: "user-1",
      senderEmail: "a@b.com",
      method: "one-click",
      status: "succeeded",
      detail: { note: "ok" },
    });
    const { rows } = await pool.query("select * from unsubscribe_attempts where id = 'ua-1'");
    expect(rows).toHaveLength(1);
  });
});

describe("ThreadRepository AI reads", () => {
  it("lists recent threads with state and prior threads by sender", async () => {
    const repo = new ThreadRepository(database);
    await seedThread("t-1", "g-1", new Date());
    await seedThread("t-2", "g-2", new Date());
    await pool.query(
      `insert into thread_states (thread_id, category, action, priority, reply_status)
       values ('t-1','needs_reply','none',50,'needs_reply')`,
    );
    const recent = await repo.listRecentWithState({
      userId: "user-1",
      since: new Date(Date.now() - 60_000),
      limit: 10,
    });
    expect(recent.map((r) => r.thread.id).sort()).toEqual(["t-1", "t-2"]);
    expect(
      recent.find((r) => r.thread.id === "t-1")?.state?.category,
    ).toBe("needs_reply");

    await seedMessage({
      id: "m-1",
      threadId: "t-2",
      gmailMessageId: "gm-1",
      direction: "inbound",
      fromAddr: "alice@acme.com",
      bodyText: "hello",
    });
    const prior = await repo.listPriorThreadsWithSenders({
      userId: "user-1",
      senderEmails: ["alice@acme.com"],
      excludeThreadId: "t-1",
      limit: 5,
    });
    expect(prior.map((p) => p.threadId)).toEqual(["t-2"]);
  });
});

describe("MessageRepository AI reads", () => {
  it("finds sent samples and prior outbound, and counts inbound senders", async () => {
    const repo = new MessageRepository(database);
    await seedThread("t-1", "g-1");
    await seedMessage({
      id: "m-1",
      threadId: "t-1",
      gmailMessageId: "gm-1",
      direction: "outbound",
      toAddr: ["bob@x.com"],
      bodyText: "hi bob",
      unsubscribe: undefined,
    });
    await seedMessage({
      id: "m-2",
      threadId: "t-1",
      gmailMessageId: "gm-2",
      direction: "inbound",
      fromAddr: "news@x.com",
      unsubscribe: { oneClick: true, url: "https://x.com/u" },
    });

    const samples = await repo.listSentSamples({ userId: "user-1", limit: 5 });
    expect(samples[0]?.bodyText).toBe("hi bob");
    expect(await repo.hasPriorOutboundTo({ userId: "user-1", email: "bob@x.com" })).toBe(true);
    expect(await repo.hasPriorOutboundTo({ userId: "user-1", email: "nobody@x.com" })).toBe(false);

    const info = await repo.findLatestInboundWithUnsubscribe({ userId: "user-1", email: "news@x.com" });
    expect(info?.gmailMessageId).toBe("gm-2");

    const counts = await repo.countInboundBySender({
      userId: "user-1",
      since: new Date(Date.now() - 60_000),
      limit: 5,
    });
    expect(counts[0]).toEqual({ email: "news@x.com", n: 1 });

    const window = await repo.listWindowForResponseTime({
      userId: "user-1",
      since: new Date(Date.now() - 60_000),
    });
    expect(window).toHaveLength(2);
  });
});
