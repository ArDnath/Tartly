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
import { AiUsageRepository } from "@/lib/repositories/ai-usage";
import { AssetRepository } from "@/lib/repositories/assets";
import { CampaignRepository } from "@/lib/repositories/campaigns";
import { CommitmentRepository } from "@/lib/repositories/commitments";
import { DraftRepository } from "@/lib/repositories/drafts";
import { FlowRunRepository } from "@/lib/repositories/flow-runs";
import { FollowupEnrollmentRepository } from "@/lib/repositories/followup-enrollments";
import { MessageRepository } from "@/lib/repositories/messages";
import { PendingActionRepository } from "@/lib/repositories/pending-actions";
import { ResearchCacheRepository } from "@/lib/repositories/research-cache";
import { ScheduledActionRepository } from "@/lib/repositories/scheduled-actions";
import { ThreadRepository } from "@/lib/repositories/threads";

/**
 * Repository integration suite (SKILL §14.1). Repositories construct the real
 * SQL, so they are exercised against an ephemeral Postgres with the production
 * migrations — not an in-memory fake. This is the seed of the C2/C3
 * "repositories + route handlers" coverage.
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
    `insert into agent_chat_thread (id, user_id)
     values ('thread-chat','user-1')`,
  );
  await pool.query(
    `insert into mailboxes (id, user_id, email)
     values ('mb-1','user-1','me@test.local')`,
  );
});

async function seedPendingAction(input: {
  id: string;
  userId?: string;
  status?: string;
  expiresAt?: Date;
}): Promise<void> {
  await pool.query(
    `insert into pending_actions
       (id, user_id, conversation_id, tool_name, arguments_hash, provider,
        status, idempotency_key, expires_at)
     values ($1,$2,'thread-chat','send_email','hash','gmail',$3,$4,$5)`,
    [
      input.id,
      input.userId ?? "user-1",
      input.status ?? "PENDING",
      `key-${input.id}`,
      input.expiresAt ?? new Date(Date.now() + 60_000),
    ],
  );
}

describe("PendingActionRepository", () => {
  it("is owner-scoped on read (BOLA)", async () => {
    await seedPendingAction({ id: "pa-1" });
    const repo = new PendingActionRepository(database);
    expect(await repo.findByIdForUser("user-1", "pa-1")).toBeDefined();
    expect(await repo.findByIdForUser("user-2", "pa-1")).toBeUndefined();
  });

  it("counts only unexpired PENDING rows", async () => {
    await seedPendingAction({ id: "pa-1" });
    await seedPendingAction({ id: "pa-2", status: "SUCCEEDED" });
    await seedPendingAction({
      id: "pa-3",
      expiresAt: new Date(Date.now() - 60_000),
    });
    const repo = new PendingActionRepository(database);
    expect(await repo.countOutstanding("user-1", new Date())).toBe(1);
  });

  it("lets exactly one caller claim PENDING → EXECUTING", async () => {
    await seedPendingAction({ id: "pa-1" });
    const repo = new PendingActionRepository(database);
    const now = new Date();
    const [first, second] = await Promise.all([
      repo.claimPending({ userId: "user-1", actionId: "pa-1", now }),
      repo.claimPending({ userId: "user-1", actionId: "pa-1", now }),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it("expires stale rows and lists them once", async () => {
    await seedPendingAction({
      id: "pa-1",
      expiresAt: new Date(Date.now() - 60_000),
    });
    const repo = new PendingActionRepository(database);
    const ids = await repo.listExpiredIds({ now: new Date(), limit: 10 });
    expect(ids).toEqual(["pa-1"]);
    await repo.markExpiredByIds(ids, new Date());
    expect(await repo.listExpiredIds({ now: new Date(), limit: 10 })).toEqual([]);
  });

  it("cannot cancel another owner's action", async () => {
    await seedPendingAction({ id: "pa-1" });
    const repo = new PendingActionRepository(database);
    const cancelled = await repo.markCancelled({
      userId: "user-2",
      actionId: "pa-1",
      now: new Date(),
    });
    expect(cancelled).toBeUndefined();
  });
});

describe("ScheduledActionRepository", () => {
  it("claims a pending schedule exactly once", async () => {
    await seedPendingAction({ id: "pa-1" });
    await pool.query(
      `insert into scheduled_actions (id, user_id, pending_action_id, run_after)
       values ('sa-1','user-1','pa-1', now() + interval '1 hour')`,
    );
    const repo = new ScheduledActionRepository(database);
    const first = await repo.claimPending("sa-1");
    expect(first?.status).toBe("processing");
    expect(await repo.claimPending("sa-1")).toBeUndefined();
  });

  it("returns a failed schedule to pending with bumped attempts", async () => {
    await seedPendingAction({ id: "pa-1" });
    await pool.query(
      `insert into scheduled_actions (id, user_id, pending_action_id, run_after)
       values ('sa-1','user-1','pa-1', now() + interval '1 hour')`,
    );
    const repo = new ScheduledActionRepository(database);
    await repo.claimPending("sa-1");
    await repo.releaseAfterFailure({
      scheduledActionId: "sa-1",
      attempts: 2,
      lastError: "boom",
    });
    const row = await repo.findByIdForUser("user-1", "sa-1");
    expect(row).toMatchObject({ status: "pending", attempts: 2, lastError: "boom" });
  });
});

describe("ResearchCacheRepository", () => {
  it("upserts per (user, key) and ignores expired rows", async () => {
    const repo = new ResearchCacheRepository(database);
    const base = {
      id: "rc-1",
      userId: "user-1",
      cacheKey: "search:web:abc",
      provider: "web",
      query: "acme",
      result: { hits: 1 },
      expiresAt: new Date(Date.now() + 60_000),
    };
    await repo.upsert(base);
    await repo.upsert({ ...base, id: "rc-2", result: { hits: 2 } });

    expect(
      await repo.findResult({
        userId: "user-1",
        cacheKey: "search:web:abc",
        now: new Date(),
      }),
    ).toEqual({ hits: 2 });

    await repo.upsert({ ...base, id: "rc-3", expiresAt: new Date(Date.now() - 1) });
    expect(
      await repo.findResult({
        userId: "user-1",
        cacheKey: "search:web:abc",
        now: new Date(),
      }),
    ).toBeNull();
  });
});

describe("ThreadRepository buckets", () => {
  async function seedThread(id: string, opts: {
    userId?: string;
    category?: string | null;
    action?: string;
    replyStatus?: string;
    unread?: boolean;
  } = {}) {
    const userId = opts.userId ?? "user-1";
    await pool.query(
      `insert into threads (id, mailbox_id, user_id, gmail_thread_id, is_unread, last_message_at)
       values ($1,'mb-1',$2,$3,$4, now())`,
      [id, userId, `g-${id}`, opts.unread ?? false],
    );
    if (opts.category !== undefined && opts.category !== null) {
      await pool.query(
        `insert into thread_states (thread_id, category, action, priority, reply_status)
         values ($1,$2,$3,10,$4)`,
        [id, opts.category, opts.action ?? "none", opts.replyStatus ?? null],
      );
    }
  }

  it("classifies each bucket with the shared CASE expression", async () => {
    const now = new Date();
    const endOfDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    await seedThread("t-needs", { category: "needs_reply" });
    await seedThread("t-fyi", { category: "fyi", replyStatus: "none" });
    await seedThread("t-waiting", { category: "awaiting_reply", replyStatus: "awaiting_them" });
    await seedThread("t-unclassified"); // no thread_states → needs_reply
    await seedThread("t-meeting", { category: "fyi" });
    await pool.query(
      `insert into meetings (id, user_id, thread_id, start_at, status)
       values ('mt-1','user-1','t-meeting', now() + interval '1 day', 'proposed')`,
    );
    await seedThread("t-followup", { category: "fyi" });
    await pool.query(
      `insert into followup_enrollments (id, user_id, thread_id, status, next_eval_at)
       values ('fe-1','user-1','t-followup','active', now() - interval '1 hour')`,
    );
    await seedThread("t-ai", { category: "fyi" });
    await pool.query(
      `insert into drafts (id, user_id, thread_id, body, status, sent_by, decided_at)
       values ('d-ai','user-1','t-ai','hi','sent','ai', now())`,
    );

    const repo = new ThreadRepository(database);
    const count = (view: string) =>
      repo.countByBucket({ userId: "user-1", view, now, endOfDay });

    expect(await count("needs_reply")).toBe(2); // t-needs + t-unclassified
    expect(await count("waiting")).toBe(1);
    expect(await count("meetings")).toBe(1);
    expect(await count("follow_up_today")).toBe(1);
    expect(await count("ai_handled")).toBe(1);
    expect(await count("fyi")).toBe(1); // t-fyi

    const listed = await repo.listInbox({
      userId: "user-1",
      view: "needs_reply",
      now,
      endOfDay,
      limit: 50,
    });
    expect(listed.map((row) => row.thread.id).sort()).toEqual([
      "t-needs",
      "t-unclassified",
    ]);
    // Postgres orders NULLS FIRST on DESC, so the state-less row may lead; the
    // join still carries the triage priority on the classified row.
    expect(
      listed.find((row) => row.thread.id === "t-needs")!.state?.priority,
    ).toBe(10);
  });

  it("never counts or lists another user's threads", async () => {
    await seedThread("t-mine", { category: "needs_reply" });
    await pool.query(
      `insert into threads (id, mailbox_id, user_id, gmail_thread_id)
       values ('t-theirs','mb-1','user-2','g-theirs')`,
    );
    await pool.query(
      `insert into thread_states (thread_id, category, action)
       values ('t-theirs','needs_reply','none')`,
    );
    const now = new Date();
    const repo = new ThreadRepository(database);
    expect(
      await repo.countByBucket({
        userId: "user-1",
        view: "needs_reply",
        now,
        endOfDay: now,
      }),
    ).toBe(1);
    const listed = await repo.listInbox({
      userId: "user-1",
      view: "needs_reply",
      now,
      endOfDay: now,
      limit: 50,
    });
    expect(listed.map((row) => row.thread.id)).toEqual(["t-mine"]);
  });
});

describe("MessageRepository", () => {
  it("returns only the newest message per thread", async () => {
    await pool.query(
      `insert into threads (id, mailbox_id, user_id, gmail_thread_id)
       values ('t-1','mb-1','user-1','g-1'), ('t-2','mb-1','user-1','g-2')`,
    );
    await pool.query(
      `insert into messages (id, thread_id, gmail_message_id, direction, sent_at)
       values ('m-old','t-1','gm-old','inbound', now() - interval '2 hours'),
              ('m-new','t-1','gm-new','inbound', now() - interval '1 hour'),
              ('m-2','t-2','gm-2','outbound', now())`,
    );
    const repo = new MessageRepository(database);
    const latest = await repo.latestByThreadIds(["t-1", "t-2"]);
    expect(latest.map((m) => m.id).sort()).toEqual(["m-2", "m-new"]);
  });

  it("returns an empty array when given no threads", async () => {
    const repo = new MessageRepository(database);
    expect(await repo.latestByThreadIds([])).toEqual([]);
  });
});

describe("DraftRepository", () => {
  it("hides suppressed drafts from the inbox pending set", async () => {
    await pool.query(
      `insert into threads (id, mailbox_id, user_id, gmail_thread_id)
       values ('t-1','mb-1','user-1','g-1'), ('t-2','mb-1','user-1','g-2')`,
    );
    await pool.query(
      `insert into drafts (id, user_id, thread_id, body, status, suppressed)
       values ('d-1','user-1','t-1','visible','pending', false),
              ('d-2','user-1','t-2','hidden','pending', true)`,
    );
    const repo = new DraftRepository(database);
    expect(await repo.listPendingThreadIds(["t-1", "t-2"])).toEqual(["t-1"]);
  });

  it("flags AI sends without a near mirror and stale pending drafts", async () => {
    await pool.query(
      `insert into threads (id, mailbox_id, user_id, gmail_thread_id)
       values ('t-recon','mb-1','user-1','g-recon')`,
    );
    // AI send two days ago with no outbound mirror within ±15 minutes.
    await pool.query(
      `insert into drafts (id, user_id, thread_id, body, status, sent_by, decided_at)
       values ('d-drift','user-1','t-recon','x','sent','ai', now() - interval '2 days')`,
    );
    // Human sends are never counted as AI drift.
    await pool.query(
      `insert into drafts (id, user_id, thread_id, body, status, sent_by, decided_at)
       values ('d-human','user-1','t-recon','h','sent','user', now())`,
    );
    // Pending draft created an hour ago; inbound arrives after it.
    await pool.query(
      `insert into drafts (id, user_id, thread_id, body, status, created_at)
       values ('d-stale','user-1','t-recon','s','pending', now() - interval '1 hour')`,
    );
    await pool.query(
      `insert into messages (id, thread_id, gmail_message_id, direction, sent_at)
       values ('m-out','t-recon','gm-out','outbound', now()),
              ('m-in','t-recon','gm-in','inbound', now())`,
    );

    const repo = new DraftRepository(database);
    expect(await repo.listAiSentWithoutMirror("user-1")).toEqual(["d-drift"]);
    expect(await repo.listStalePending("user-1")).toEqual(["d-stale"]);
    expect(await repo.listAiSentWithoutMirror("user-2")).toEqual([]);
    expect(await repo.listStalePending("user-2")).toEqual([]);
  });
});

async function seedMirrorThread(id: string, userId = "user-1"): Promise<void> {
  await pool.query(
    `insert into threads (id, mailbox_id, user_id, gmail_thread_id)
     values ($1,'mb-1',$2,$3)`,
    [id, userId, `g-${id}`],
  );
}

const campaignTemplate = { subject: "Hi", body: "Hello" };

describe("CampaignRepository", () => {
  it("claims a pending batch once and moves it to sending", async () => {
    const repo = new CampaignRepository(database);
    await repo.insertCampaign({
      id: "c-1",
      userId: "user-1",
      name: "Test",
      template: campaignTemplate,
    });
    await repo.insertRecipient({
      id: "r-1",
      campaignId: "c-1",
      userId: "user-1",
      email: "a@x.com",
      status: "pending",
    });
    await repo.insertRecipient({
      id: "r-2",
      campaignId: "c-1",
      userId: "user-1",
      email: "b@x.com",
      status: "pending",
    });

    const claimed = await repo.claimRecipientBatch("c-1", 10);
    expect(claimed.map((row) => row.id).sort()).toEqual(["r-1", "r-2"]);
    expect(claimed.every((row) => row.status === "sending" && row.attempts === 1)).toBe(
      true,
    );
    expect(await repo.claimRecipientBatch("c-1", 10)).toEqual([]);
    expect(await repo.countPending("c-1")).toBe(0);
  });

  it("only returns stale `sending` rows to pending", async () => {
    const repo = new CampaignRepository(database);
    await repo.insertCampaign({
      id: "c-1",
      userId: "user-1",
      name: "Test",
      template: campaignTemplate,
    });
    await repo.insertRecipient({
      id: "r-stale",
      campaignId: "c-1",
      userId: "user-1",
      email: "a@x.com",
      status: "sending",
    });
    await repo.insertRecipient({
      id: "r-fresh",
      campaignId: "c-1",
      userId: "user-1",
      email: "b@x.com",
      status: "sending",
    });
    await pool.query(
      `update bulk_recipients set updated_at = now() - interval '1 hour'
        where id = 'r-stale'`,
    );

    const reset = await repo.resetStaleClaims({
      campaignId: "c-1",
      cutoff: new Date(Date.now() - 60_000),
    });
    expect(reset).toBe(1);
    expect(await repo.countPending("c-1")).toBe(1);
  });

  it("dedupes suppression per (user, email)", async () => {
    const repo = new CampaignRepository(database);
    await repo.addSuppression({
      id: "s-1",
      userId: "user-1",
      email: "A@X.com",
      reason: "manual",
    });
    await repo.addSuppression({
      id: "s-2",
      userId: "user-1",
      email: "a@x.com",
      reason: "manual",
    });

    expect(await repo.isSuppressed("user-1", "a@x.com")).toBe(true);
    expect(await repo.isSuppressed("user-2", "a@x.com")).toBe(false);
    expect(
      await repo.listSuppressedEmails("user-1", ["a@x.com", "b@x.com"]),
    ).toEqual(["a@x.com"]);
  });

  it("groups recipient counts by status across campaigns", async () => {
    const repo = new CampaignRepository(database);
    for (const id of ["c-1", "c-2"]) {
      await repo.insertCampaign({
        id,
        userId: "user-1",
        name: id,
        template: campaignTemplate,
      });
    }
    await repo.insertRecipient({
      id: "r-1",
      campaignId: "c-1",
      userId: "user-1",
      email: "a@x.com",
      status: "sent",
    });
    await repo.insertRecipient({
      id: "r-2",
      campaignId: "c-1",
      userId: "user-1",
      email: "b@x.com",
      status: "failed",
    });
    await repo.insertRecipient({
      id: "r-3",
      campaignId: "c-2",
      userId: "user-1",
      email: "c@x.com",
      status: "sent",
    });

    const counts = await repo.countByStatusForCampaigns(["c-1", "c-2"]);
    expect(counts).toEqual(
      expect.arrayContaining([
        { campaignId: "c-1", status: "sent", n: 1 },
        { campaignId: "c-1", status: "failed", n: 1 },
        { campaignId: "c-2", status: "sent", n: 1 },
      ]),
    );
  });
});

describe("CommitmentRepository", () => {
  it("resolves only open promises on a thread", async () => {
    await seedMirrorThread("t-1");
    const repo = new CommitmentRepository(database);
    await repo.insert({
      id: "cm-1",
      userId: "user-1",
      threadId: "t-1",
      direction: "we_owe",
      description: "send the deck",
      status: "open",
    });
    await repo.insert({
      id: "cm-2",
      userId: "user-1",
      threadId: "t-1",
      direction: "they_owe",
      description: "send pricing",
      status: "open",
    });
    await repo.insert({
      id: "cm-3",
      userId: "user-1",
      threadId: "t-1",
      direction: "we_owe",
      description: "done already",
      status: "fulfilled",
    });

    const resolved = await repo.resolveOpenForThread({
      threadId: "t-1",
      direction: "we_owe",
      now: new Date(),
    });
    expect(resolved).toBe(1);
    const open = await repo.listOpen({ userId: "user-1", limit: 50 });
    expect(open.map((row) => row.id)).toEqual(["cm-2"]);
  });

  it("excludes capped, cooled-down and thread-less promises from nudges", async () => {
    await seedMirrorThread("t-1");
    const repo = new CommitmentRepository(database);
    const now = new Date();
    const dueAt = new Date(now.getTime() - 60_000);

    await repo.insert({
      id: "cm-due",
      userId: "user-1",
      threadId: "t-1",
      direction: "we_owe",
      description: "due",
      status: "open",
      dueAt,
    });
    await repo.insert({
      id: "cm-capped",
      userId: "user-1",
      threadId: "t-1",
      direction: "we_owe",
      description: "capped",
      status: "open",
      dueAt,
      nudgeCount: 2,
    });
    await repo.insert({
      id: "cm-future",
      userId: "user-1",
      threadId: "t-1",
      direction: "we_owe",
      description: "future",
      status: "open",
      dueAt: new Date(now.getTime() + 86_400_000),
    });
    await repo.insert({
      id: "cm-cooling",
      userId: "user-1",
      threadId: "t-1",
      direction: "we_owe",
      description: "cooling",
      status: "open",
      dueAt,
      nudgeCount: 1,
      nudgedAt: now,
    });
    await repo.insert({
      id: "cm-orphan",
      userId: "user-1",
      threadId: null,
      direction: "we_owe",
      description: "orphan",
      status: "open",
      dueAt,
    });

    const due = await repo.listDueForNudge({
      now,
      nudgeNotBefore: new Date(now.getTime() - 3 * 86_400_000),
      maxNudges: 2,
      limit: 50,
    });
    expect(due.map((row) => row.id)).toEqual(["cm-due"]);
  });
});

describe("FollowupEnrollmentRepository", () => {
  it("lists only due active enrollments and stops by thread", async () => {
    await seedMirrorThread("t-1");
    await seedMirrorThread("t-2");
    const repo = new FollowupEnrollmentRepository(database);
    const now = new Date();
    await repo.insert({
      id: "fe-due",
      userId: "user-1",
      threadId: "t-1",
      status: "active",
      nextEvalAt: new Date(now.getTime() - 60_000),
    });
    await repo.insert({
      id: "fe-paused",
      userId: "user-1",
      threadId: "t-1",
      status: "paused",
      nextEvalAt: new Date(now.getTime() - 60_000),
    });
    await repo.insert({
      id: "fe-future",
      userId: "user-1",
      threadId: "t-2",
      status: "active",
      nextEvalAt: new Date(now.getTime() + 86_400_000),
    });

    const due = await repo.listDueActive({ now, limit: 50 });
    expect(due.map((row) => row.id)).toEqual(["fe-due"]);

    const stopped = await repo.stopActiveByThread({
      threadId: "t-1",
      reason: "replied",
      now,
    });
    expect(stopped).toBe(1);
    expect(await repo.countActive("user-1")).toBe(1);

    const forUser = await repo.listActiveDueForUser({
      userId: "user-1",
      before: new Date(now.getTime() + 2 * 86_400_000),
      limit: 50,
    });
    expect(forUser.map((row) => row.enrollmentId)).toEqual(["fe-future"]);
    expect(forUser[0]!.subject).toBeNull();
  });
});

describe("AssetRepository", () => {
  const baseAsset = {
    id: "a-1",
    userId: "user-1",
    kind: "image" as const,
    filename: "logo.png",
    mimeType: "image/png",
    sizeBytes: 10,
    storageKey: "assets/user-1/hash",
    sha256: "hash",
    altText: "logo",
  };

  it("upserts per (user, sha) and preserves alt text when omitted", async () => {
    const repo = new AssetRepository(database);
    await repo.upsert({ row: baseAsset, altTextProvided: true });
    const second = await repo.upsert({
      row: { ...baseAsset, id: "a-2", altText: null, sizeBytes: 20 },
      altTextProvided: false,
    });
    expect(second.id).toBe("a-1");
    expect(second.altText).toBe("logo");
    expect(second.sizeBytes).toBe(20);
  });

  it("hides soft-deleted assets from active reads", async () => {
    const repo = new AssetRepository(database);
    await repo.upsert({ row: baseAsset, altTextProvided: true });
    expect(await repo.listActive({ userId: "user-1", limit: 10 })).toHaveLength(1);
    const deleted = await repo.softDelete({
      userId: "user-1",
      id: "a-1",
      now: new Date(),
    });
    expect(deleted).toBe(true);
    expect(await repo.findActiveByIdForUser("user-1", "a-1")).toBeUndefined();
    expect(await repo.findByIdForUser("user-1", "a-1")).toBeDefined();
    expect(await repo.listActive({ userId: "user-1", limit: 10 })).toEqual([]);
  });
});

describe("AiUsageRepository", () => {
  it("aggregates calls, failures and cost per feature", async () => {
    const repo = new AiUsageRepository(database);
    await repo.insert({
      id: "u-1",
      userId: "user-1",
      feature: "triage",
      provider: "openai",
      model: "gpt-4o-mini",
      role: "fast",
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      estimatedCostMicros: 10,
      ok: true,
    });
    await repo.insert({
      id: "u-2",
      userId: "user-1",
      feature: "triage",
      provider: "openai",
      model: "gpt-4o-mini",
      role: "fast",
      promptTokens: 200,
      completionTokens: 0,
      totalTokens: 200,
      estimatedCostMicros: 0,
      ok: false,
    });
    const window = {
      userId: "user-1",
      since: new Date(Date.now() - 60_000),
      until: new Date(Date.now() + 60_000),
    };
    const totals = await repo.summaryTotals(window);
    expect(totals).toMatchObject({ calls: 2, failedCalls: 1, totalTokens: 350 });
    const byFeature = await repo.summaryByFeature(window);
    expect(byFeature).toEqual([
      { feature: "triage", calls: 2, totalTokens: 350, estimatedCostMicros: 10 },
    ]);
  });
});

/**
 * Phase C5: keyset pagination. These pin the exact ordering the opaque cursor
 * reproduces — crucially the inbox's nullable `priority` under Postgres'
 * default `DESC NULLS FIRST`, which an OFFSET or a naive cursor would get
 * wrong between pages.
 */
describe("Cursor pagination (C5)", () => {
  it("inbox: pages preserve DESC NULLS FIRST order with no gaps or dupes", async () => {
    const repo = new ThreadRepository(database);
    const now = new Date();
    const endOfDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const seed = async (
      id: string,
      priority: number | null,
      lastMessageAt: string,
    ) => {
      await pool.query(
        `insert into threads (id, mailbox_id, user_id, gmail_thread_id, last_message_at)
         values ($1,'mb-1','user-1',$2,$3)`,
        [id, `g-${id}`, lastMessageAt],
      );
      if (priority !== null) {
        await pool.query(
          `insert into thread_states (thread_id, category, action, priority)
           values ($1,'needs_reply','none',$2)`,
          [id, priority],
        );
      }
    };

    await seed("t-a", 10, "2026-01-01T10:00:00.000Z");
    await seed("t-b", 10, "2026-01-01T09:00:00.000Z");
    await seed("t-c", 5, "2026-01-01T11:00:00.000Z");
    await seed("t-d", null, "2026-01-01T12:00:00.000Z");
    await seed("t-e", null, "2026-01-01T08:00:00.000Z");

    const expected = ["t-d", "t-e", "t-a", "t-b", "t-c"];
    const full = await repo.listInbox({
      userId: "user-1",
      view: "needs_reply",
      now,
      endOfDay,
      limit: 50,
    });
    expect(full.map((row) => row.thread.id)).toEqual(expected);

    const paged: string[] = [];
    let after:
      | { priority: number | null; lastMessageAt: Date | null; id: string }
      | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const rows = await repo.listInbox({
        userId: "user-1",
        view: "needs_reply",
        now,
        endOfDay,
        ...(after ? { after } : {}),
        limit: 3, // limit(2) + 1, as the service over-fetches
      });
      const hasMore = rows.length > 2;
      const pageRows = hasMore ? rows.slice(0, 2) : rows;
      paged.push(...pageRows.map((row) => row.thread.id));
      if (!hasMore) break;
      const last = pageRows[pageRows.length - 1]!;
      after = {
        priority: last.state?.priority ?? null,
        lastMessageAt: last.thread.lastMessageAt ?? null,
        id: last.thread.id,
      };
    }
    expect(paged).toEqual(expected);
    expect(new Set(paged).size).toBe(paged.length);
  });

  it("follow-ups: pages newest-first with an id tie-breaker", async () => {
    for (const id of ["t-1", "t-2", "t-3"]) await seedMirrorThread(id);
    await pool.query(
      `insert into followup_enrollments (id, user_id, thread_id, status, created_at)
       values ('fe-1','user-1','t-1','active','2026-01-01T10:00:00Z'),
              ('fe-2','user-1','t-2','active','2026-01-01T09:00:00Z'),
              ('fe-3','user-1','t-3','active','2026-01-01T08:00:00Z')`,
    );
    const repo = new FollowupEnrollmentRepository(database);

    const first = await repo.listForUserWithSubject({
      userId: "user-1",
      limit: 3, // limit(2) + 1
    });
    expect(first.map((row) => row.enrollment.id)).toEqual(["fe-1", "fe-2", "fe-3"]);

    const second = await repo.listForUserWithSubject({
      userId: "user-1",
      after: { createdAt: first[1]!.enrollment.createdAt, id: "fe-2" },
      limit: 3,
    });
    expect(second.map((row) => row.enrollment.id)).toEqual(["fe-3"]);
  });

  it("agent actions: pages by createdAt desc", async () => {
    await pool.query(
      `insert into pending_actions
         (id, user_id, conversation_id, tool_name, arguments_hash, provider,
          status, idempotency_key, expires_at, created_at)
       values
         ('pa-1','user-1','thread-chat','a','h','gmail','PENDING','k1', now() + interval '1 hour','2026-01-01T10:00:00Z'),
         ('pa-2','user-1','thread-chat','a','h','gmail','PENDING','k2', now() + interval '1 hour','2026-01-01T09:00:00Z'),
         ('pa-3','user-1','thread-chat','a','h','gmail','PENDING','k3', now() + interval '1 hour','2026-01-01T08:00:00Z')`,
    );
    const repo = new PendingActionRepository(database);

    const first = await repo.listForUser({ userId: "user-1", limit: 3 });
    expect(first.map((row) => row.id)).toEqual(["pa-1", "pa-2", "pa-3"]);

    const second = await repo.listForUser({
      userId: "user-1",
      after: { createdAt: first[1]!.createdAt, id: "pa-2" },
      limit: 3,
    });
    expect(second.map((row) => row.id)).toEqual(["pa-3"]);
  });

  it("flow runs: pages by startedAt desc and stays owner-scoped", async () => {
    await pool.query(
      `insert into flows (id, user_id, name, graph)
       values ('fl-1','user-1','F','{}')`,
    );
    await pool.query(
      `insert into flow_runs (id, user_id, flow_id, trigger_kind, started_at)
       values
         ('run-1','user-1','fl-1','inbound','2026-01-01T10:00:00Z'),
         ('run-2','user-1','fl-1','inbound','2026-01-01T09:00:00Z'),
         ('run-3','user-1','fl-1','inbound','2026-01-01T08:00:00Z')`,
    );
    const repo = new FlowRunRepository(database);

    const first = await repo.listForUser({ userId: "user-1", limit: 3 });
    expect(first.map((row) => row.id)).toEqual(["run-1", "run-2", "run-3"]);

    const second = await repo.listForUser({
      userId: "user-1",
      after: { startedAt: first[1]!.startedAt, id: "run-2" },
      limit: 3,
    });
    expect(second.map((row) => row.id)).toEqual(["run-3"]);

    expect(await repo.listForUser({ userId: "user-2", limit: 10 })).toEqual([]);
  });
});
