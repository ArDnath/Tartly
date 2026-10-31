import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { CHECKPOINT_FORMAT } from "@tartly/flow-runtime";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { DatabaseCheckpointStore } from "@/lib/engine/checkpoint-store";
import { ActivityRepository } from "@/lib/repositories/activity";
import { AgentRunRepository } from "@/lib/repositories/agent-runs";
import { CalendarPersistenceRepository } from "@/lib/repositories/calendar-persistence";
import { ContactPersistenceRepository } from "@/lib/repositories/contact-persistence";
import { EngineDraftRepository } from "@/lib/repositories/engine-drafts";
import { FlowRepository } from "@/lib/repositories/engine-flows";
import { EnginePersistenceRepository } from "@/lib/repositories/engine-persistence";
import { EngineThreadStateRepository } from "@/lib/repositories/engine-thread-states";
import { EventLogRepository } from "@/lib/repositories/event-log";
import { GmailSendLedgerRepository } from "@/lib/repositories/gmail-send-ledger";
import { GoogleAccountRepository } from "@/lib/repositories/google-account";
import { InboundEmailRepository } from "@/lib/repositories/inbound-email";
import { MailboxRepository } from "@/lib/repositories/mailboxes";
import { MeetingRepository } from "@/lib/repositories/meetings";
import { MessageRepository } from "@/lib/repositories/messages";
import { OnboardingRepository } from "@/lib/repositories/onboarding";
import { SendLedgerRepository } from "@/lib/repositories/send-ledger";
import { ThreadActivityRepository } from "@/lib/repositories/thread-activity";
import { ThreadRepository } from "@/lib/repositories/threads";
import { ThreadSettingsRepository } from "@/lib/repositories/thread-settings";
import { UserRepository } from "@/lib/repositories/users";

/**
 * Integration suite for the C2 repositories that were not yet exercised by
 * `repositories.test.ts` / `ai-repositories.test.ts` (SKILL §14.1). Real
 * Postgres + production migrations, so the SQL — not a fake — is under test.
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
    `insert into agent_chat_thread (id, user_id) values ('thread-chat','user-1')`,
  );
  await pool.query(
    `insert into mailboxes (id, user_id, email)
     values ('mb-1','user-1','me@test.local')`,
  );
});

async function seedThread(
  id: string,
  opts: {
    userId?: string;
    mailboxId?: string;
    gmailThreadId?: string;
    subject?: string | null;
    unread?: boolean;
    lastMessageAt?: Date | null;
  } = {},
): Promise<void> {
  await pool.query(
    `insert into threads (id, mailbox_id, user_id, gmail_thread_id, subject, is_unread, last_message_at)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      id,
      opts.mailboxId ?? "mb-1",
      opts.userId ?? "user-1",
      opts.gmailThreadId ?? `g-${id}`,
      opts.subject ?? null,
      opts.unread ?? false,
      opts.lastMessageAt ?? null,
    ],
  );
}

async function seedFlow(id: string, userId = "user-1"): Promise<void> {
  await pool.query(
    `insert into flows (id, user_id, name, graph) values ($1,$2,$3,'{}')`,
    [id, userId, `flow-${id}`],
  );
}

async function seedFlowRun(
  id: string,
  flowId: string,
  userId = "user-1",
): Promise<void> {
  await pool.query(
    `insert into flow_runs (id, user_id, flow_id, trigger_kind)
     values ($1,$2,$3,'manual')`,
    [id, userId, flowId],
  );
}

describe("UserRepository", () => {
  it("checks existence and reads the display name", async () => {
    const repo = new UserRepository(database);
    expect(await repo.existsById("user-1")).toBe(true);
    expect(await repo.existsById("missing")).toBe(false);
    expect(await repo.findNameById("user-1")).toBe("User One");
    expect(await repo.findNameById("missing")).toBeNull();
  });
});

describe("OnboardingRepository", () => {
  it("inserts once and then updates by user", async () => {
    const repo = new OnboardingRepository(database);
    const first = await repo.insertIfAbsent({ userId: "user-1" });
    expect(first?.status).toBe("PROFILE_CREATION");
    expect(await repo.insertIfAbsent({ userId: "user-1" })).toBeUndefined();

    const updated = await repo.updateByUser("user-1", { status: "COMPLETE" });
    expect(updated.status).toBe("COMPLETE");
    expect((await repo.findByUser("user-1"))?.status).toBe("COMPLETE");
    expect(await repo.findByUser("user-2")).toBeUndefined();
  });
});

describe("AgentRunRepository", () => {
  it("is owner-scoped on the conversation probe and updates runs", async () => {
    const repo = new AgentRunRepository(database);
    expect(await repo.findThreadIdForUser("user-1", "thread-chat")).toBeDefined();
    expect(
      await repo.findThreadIdForUser("user-2", "thread-chat"),
    ).toBeUndefined();

    await repo.insertRun({
      id: "run-1",
      userId: "user-1",
      conversationId: "thread-chat",
      requestId: "req-1",
      model: "test",
    });
    await repo.updateRunById({
      runId: "run-1",
      values: { status: "completed", stepCount: 3 },
    });
    const row = (
      await pool.query<{ status: string; step_count: number }>(
        `select status, step_count from agent_runs where id = 'run-1'`,
      )
    ).rows[0];
    expect(row).toMatchObject({ status: "completed", step_count: 3 });

    await repo.updateCompactionSummary("thread-chat", "summary text");
    const thread = (
      await pool.query<{ compaction_summary: string }>(
        `select compaction_summary from agent_chat_thread where id = 'thread-chat'`,
      )
    ).rows[0];
    expect(thread?.compaction_summary).toBe("summary text");
  });
});

describe("ThreadSettingsRepository", () => {
  it("resolves and updates mailbox, contact and thread autonomy", async () => {
    const repo = new ThreadSettingsRepository(database);
    expect(await repo.findMailboxAutonomyForUser("user-1")).toBe("copilot");
    expect(
      await repo.updateMailboxAutonomy({
        userId: "user-1",
        autonomy: "autopilot",
        now: new Date(),
      }),
    ).toBe(true);
    expect(await repo.findMailboxAutonomyById("mb-1")).toBe("autopilot");

    await new ContactPersistenceRepository(database).upsert({
      id: "c-1",
      userId: "user-1",
      email: "person@x.com",
      name: "Person",
      source: "test",
    });
    expect(
      await repo.updateContactOverride({
        userId: "user-1",
        email: "PERSON@x.com",
        override: "copilot",
        now: new Date(),
      }),
    ).toBe(true);
    expect(
      await repo.findContactOverride({ userId: "user-1", email: "person@x.com" }),
    ).toBe("copilot");
    expect(await repo.listContactOverridesForUser("user-1")).toEqual([
      { email: "person@x.com", name: "Person", override: "copilot" },
    ]);

    await seedThread("t-1", { subject: "Hello" });
    await repo.upsertThreadAutonomy({
      threadId: "t-1",
      userId: "user-1",
      autonomy: "autopilot",
      now: new Date(),
    });
    expect(
      await repo.findThreadAutonomy({ userId: "user-1", threadId: "t-1" }),
    ).toBe("autopilot");
    expect(await repo.listThreadOverridesWithSubject("user-1")).toEqual([
      { threadId: "t-1", autonomy: "autopilot", subject: "Hello" },
    ]);

    await repo.deleteThreadAutonomy({ userId: "user-1", threadId: "t-1" });
    expect(
      await repo.findThreadAutonomy({ userId: "user-1", threadId: "t-1" }),
    ).toBeUndefined();
  });
});

describe("ThreadActivityRepository", () => {
  it("streams threads past a cursor and scopes the batched form", async () => {
    const repo = new ThreadActivityRepository(database);
    const base = new Date("2026-01-01T00:00:00Z");
    await seedThread("t-old", { lastMessageAt: new Date(base.getTime() - 1000) });
    await seedThread("t-new", { lastMessageAt: new Date(base.getTime() + 1000) });
    await seedThread("t-theirs", {
      userId: "user-2",
      lastMessageAt: new Date(base.getTime() + 2000),
    });

    const since = await repo.listSince({ userId: "user-1", since: base, limit: 10 });
    expect(since.map((row) => row.id)).toEqual(["t-new"]);
    expect(since[0]!.gmailThreadId).toBe("g-t-new");

    const many = await repo.listSinceMany({
      userIds: ["user-1", "user-2"],
      since: base,
      limit: 10,
    });
    expect(many.map((row) => row.id).sort()).toEqual(["t-new", "t-theirs"]);
    expect(many.find((row) => row.id === "t-theirs")?.userId).toBe("user-2");
  });
});

describe("EventLogRepository", () => {
  it("dedupes redeliveries and marks processed", async () => {
    const repo = new EventLogRepository(database);
    const first = await repo.insertIfAbsent({
      id: "ev-1",
      userId: "user-1",
      kind: "gmail",
      externalId: "ext-1",
    });
    expect(first?.id).toBe("ev-1");
    expect(
      await repo.insertIfAbsent({
        id: "ev-2",
        userId: "user-1",
        kind: "gmail",
        externalId: "ext-1",
      }),
    ).toBeUndefined();
    // A different user is a different dedupe scope.
    const otherUser = await repo.insertIfAbsent({
      id: "ev-3",
      userId: "user-2",
      kind: "gmail",
      externalId: "ext-1",
    });
    expect(otherUser?.id).toBe("ev-3");

    await repo.markProcessed("ev-1", new Date("2026-01-02T00:00:00Z"));
    expect((await repo.findById("ev-1"))?.processedAt).toBeInstanceOf(Date);
    expect(
      await repo.findIdByExternalId({ userId: "user-1", externalId: "ext-1" }),
    ).toEqual({ id: "ev-1" });
  });

  it("purges only rows older than the cutoff", async () => {
    const repo = new EventLogRepository(database);
    await repo.insertIfAbsent({
      id: "ev-old",
      userId: "user-1",
      kind: "gmail",
      externalId: "old",
    });
    await repo.insertIfAbsent({
      id: "ev-new",
      userId: "user-1",
      kind: "gmail",
      externalId: "new",
    });
    await pool.query(
      `update event_log set created_at = now() - interval '40 days' where id = 'ev-old'`,
    );

    const deleted = await repo.deleteBefore(
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    );
    expect(deleted).toBe(1);
    expect(await repo.findById("ev-old")).toBeUndefined();
    expect(await repo.findById("ev-new")).toBeDefined();
  });
});

describe("ContactPersistenceRepository", () => {
  it("upserts by (user, email) and refreshes the name", async () => {
    const repo = new ContactPersistenceRepository(database);
    await repo.upsert({
      id: "c-1",
      userId: "user-1",
      email: "a@x.com",
      name: "Alice",
      source: "sync",
    });
    const updated = await repo.upsert({
      id: "c-2",
      userId: "user-1",
      email: "a@x.com",
      name: "Alice Smith",
      source: "sync",
    });
    expect(updated.id).toBe("c-1");
    expect(updated.name).toBe("Alice Smith");
    expect(updated.nameLower).toBe("alice smith");
    const count = await pool.query(
      `select count(*)::int as n from contacts where user_id = 'user-1'`,
    );
    expect(count.rows[0].n).toBe(1);
  });
});

describe("InboundEmailRepository", () => {
  it("selects unread or never-triaged threads, newest first", async () => {
    const repo = new InboundEmailRepository(database);
    const base = new Date("2026-01-01T00:00:00Z");
    await seedThread("t-unread", {
      unread: true,
      lastMessageAt: new Date(base.getTime() + 1000),
    });
    await seedThread("t-untriaged", {
      lastMessageAt: new Date(base.getTime() + 2000),
    });
    await seedThread("t-done", { lastMessageAt: new Date(base.getTime() + 3000) });
    await pool.query(
      `insert into thread_states (thread_id, category, action) values ('t-done','fyi','none')`,
    );

    const candidates = await repo.listTriageCandidates({ mailboxId: "mb-1", limit: 10 });
    expect(candidates.map((row) => row.id)).toEqual(["t-untriaged", "t-unread"]);
  });
});

describe("GoogleAccountRepository", () => {
  it("reads the linked account id and scopes", async () => {
    const repo = new GoogleAccountRepository(database);
    await pool.query(
      `insert into account (id, account_id, provider_id, user_id, scope, created_at, updated_at)
       values ('acc-1','sub-1','google','user-1','openid email', now(), now())`,
    );
    expect(
      await repo.findIdByUserAndProvider({ userId: "user-1", providerId: "google" }),
    ).toBe("acc-1");
    expect(
      await repo.findIdByUserAndProvider({ userId: "user-1", providerId: "github" }),
    ).toBeUndefined();
    expect(
      await repo.listScopesByUserAndProvider({
        userId: "user-1",
        providerId: "google",
      }),
    ).toEqual(["openid email"]);
  });
});

describe("GmailSendLedgerRepository", () => {
  it("claims an idempotency key once and tracks its status", async () => {
    const repo = new GmailSendLedgerRepository(database);
    const claim = await repo.claim({
      id: "sl-1",
      userId: "user-1",
      idempotencyKey: "key-1",
      status: "sending",
    });
    expect(claim?.status).toBe("sending");
    expect(
      await repo.claim({
        id: "sl-2",
        userId: "user-1",
        idempotencyKey: "key-1",
        status: "sending",
      }),
    ).toBeUndefined();

    await repo.updateStatus("key-1", "sent");
    expect(await repo.findStatus("key-1")).toBe("sent");
    expect(await repo.findStatus("missing")).toBeUndefined();
  });
});

describe("SendLedgerRepository", () => {
  it("deletes only ledger rows older than the cutoff", async () => {
    const repo = new SendLedgerRepository(database);
    await repo.claimDraft({
      id: "sl-old",
      userId: "user-1",
      idempotencyKey: "commitment:old",
      seq: 1,
    });
    await repo.claimDraft({
      id: "sl-new",
      userId: "user-1",
      idempotencyKey: "commitment:new",
      seq: 2,
    });
    await pool.query(
      `update send_ledger set created_at = now() - interval '120 days' where id = 'sl-old'`,
    );

    const deleted = await repo.deleteBefore(
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    );
    expect(deleted).toBe(1);
    const remaining = await pool.query<{ id: string }>(
      `select id from send_ledger order by id`,
    );
    expect(remaining.rows.map((row) => row.id)).toEqual(["sl-new"]);
  });
});

describe("CalendarPersistenceRepository", () => {
  it("upserts settings and reads them back (defaults included)", async () => {
    const repo = new CalendarPersistenceRepository(database);
    expect(await repo.findSettingsByUser("user-1")).toBeUndefined();
    await repo.upsertSettings({
      userId: "user-1",
      values: { timezone: "Europe/Berlin" },
    });
    await repo.upsertSettings({
      userId: "user-1",
      values: { timezone: "America/New_York" },
    });
    expect(await repo.findSettingsTimezoneByUser("user-1")).toBe("America/New_York");
    const settings = await repo.findSettingsByUser("user-1");
    expect(settings?.workStartHour).toBe(9); // column default survived the upsert
  });

  it("creates, cancels and reschedules meetings owner-scoped", async () => {
    const repo = new CalendarPersistenceRepository(database);
    await seedThread("t-1");
    await repo.insertMeeting({
      id: "mt-1",
      userId: "user-1",
      threadId: "t-1",
      subject: "Kickoff",
      startAt: new Date("2026-02-01T10:00:00Z"),
      endAt: new Date("2026-02-01T10:30:00Z"),
    });
    expect((await repo.findLatestMeetingByThread("t-1"))?.id).toBe("mt-1");
    expect(await repo.cancelMeetingOwned({ userId: "user-2", meetingId: "mt-1" })).toBeUndefined();
    expect(
      (await repo.listMeetingsForUser("user-1", 50)).map((m) => m.id),
    ).toEqual(["mt-1"]);

    const rescheduled = await repo.rescheduleMeetingOwned({
      userId: "user-1",
      meetingId: "mt-1",
      startAt: new Date("2026-02-02T11:00:00Z"),
      endAt: new Date("2026-02-02T11:30:00Z"),
    });
    expect(rescheduled?.status).toBe("confirmed");
  });

  it("keeps one meeting per (thread, proposal)", async () => {
    const repo = new CalendarPersistenceRepository(database);
    await seedThread("t-1");
    const base = {
      id: "mt-1",
      userId: "user-1",
      threadId: "t-1",
      proposalId: "p-1",
      subject: "Proposal",
    };
    expect(await repo.findMeetingByThreadAndProposal({ threadId: "t-1", proposalId: "p-1" })).toBeUndefined();
    expect(await repo.insertProposalMeeting(base)).toBeDefined();
    expect(await repo.insertProposalMeeting({ ...base, id: "mt-2" })).toBeUndefined();
    expect(
      (await repo.findMeetingByThreadAndProposal({ threadId: "t-1", proposalId: "p-1" }))?.id,
    ).toBe("mt-1");
  });

  it("reads the latest draft's run state for a proposal", async () => {
    const repo = new CalendarPersistenceRepository(database);
    await seedThread("t-1");
    await seedFlow("flow-1");
    await seedFlowRun("run-1", "flow-1");
    await pool.query(`update flow_runs set state = '{"step":"proposed"}'::jsonb where id = 'run-1'`);
    await pool.query(
      `insert into drafts (id, user_id, thread_id, body, run_id)
       values ('d-1','user-1','t-1','hi','run-1')`,
    );
    expect(await repo.findLatestDraftRunId("t-1")).toBe("run-1");
    expect(await repo.findFlowRunState("run-1")).toEqual({ step: "proposed" });
  });
});

describe("Engine repositories", () => {
  it("EngineDraftRepository inserts and refreshes a pending draft", async () => {
    const repo = new EngineDraftRepository(database);
    await seedThread("t-1");
    await seedFlow("flow-1");
    await seedFlowRun("run-1", "flow-1");
    await repo.insert({
      id: "d-1",
      userId: "user-1",
      threadId: "t-1",
      body: "first",
    });
    await repo.updatePending({
      draftId: "d-1",
      body: "second",
      runId: "run-1",
      editedBody: "edited",
      confidence: "HIGH",
      suppressed: false,
      pipelineVersion: "v2",
    });
    const row = (
      await pool.query(
        `select body, run_id, edited_body, confidence, pipeline_version from drafts where id = 'd-1'`,
      )
    ).rows[0];
    expect(row).toMatchObject({
      body: "second",
      run_id: "run-1",
      edited_body: "edited",
      confidence: "HIGH",
      pipeline_version: "v2",
    });
  });

  it("FlowRepository finds, inserts and patches a flow graph", async () => {
    const repo = new FlowRepository(database);
    expect(await repo.findByNameForUser("user-1", "missing")).toBeUndefined();
    const flow = await repo.insert({ id: "flow-1", userId: "user-1", name: "Daily", graph: {} });
    expect(flow.id).toBe("flow-1");
    expect((await repo.findByNameForUser("user-1", "Daily"))?.id).toBe("flow-1");
    await repo.updateGraphById("flow-1", { node: "a" });
    expect((await repo.findByNameForUser("user-1", "Daily"))?.graph).toEqual({ node: "a" });
  });

  it("Thread/Mailbox/Meeting repositories serve unscoped engine lookups", async () => {
    const threads = new ThreadRepository(database);
    const mailboxes = new MailboxRepository(database);
    const meetings = new MeetingRepository(database);
    await seedThread("t-1", { subject: "Hi" });
    await pool.query(
      `insert into meetings (id, user_id, thread_id, subject) values ('mt-1','user-1','t-1','M')`,
    );
    expect((await threads.findById("t-1"))?.subject).toBe("Hi");
    expect(await threads.findMailboxIdById("t-1")).toBe("mb-1");
    expect(
      await mailboxes.findEmailByIdForUser({ mailboxId: "mb-1", userId: "user-1" }),
    ).toBe("me@test.local");
    expect(
      await mailboxes.findEmailByIdForUser({ mailboxId: "mb-1", userId: "user-2" }),
    ).toBeUndefined();
    expect((await meetings.findById("mt-1"))?.subject).toBe("M");
  });

  it("EnginePersistenceRepository checkpoints and finishes a run", async () => {
    const repo = new EnginePersistenceRepository(database);
    await seedFlow("flow-1");
    await seedFlowRun("run-1", "flow-1");
    await repo.insertCheckpoint({
      id: "cp-1",
      runId: "run-1",
      nodeId: "n1",
      status: "ok",
      output: { value: 1 },
    });
    const checkpoints = await repo.listCheckpoints("run-1");
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]).toMatchObject({ nodeId: "n1", status: "ok" });

    const store = new DatabaseCheckpointStore(database);
    await store.append("run-1", {
      format: CHECKPOINT_FORMAT,
      seq: 2,
      nodeId: "n2",
      nodeType: "step",
      status: "ok",
      ms: 3,
      at: "2026-10-31T12:00:00.000Z",
      output: { ok: true },
      state: { done: true },
      nextNodeId: null,
      continued: true,
    });
    const loaded = await store.load("run-1");
    expect(loaded).toHaveLength(2);
    expect(loaded[1]).toMatchObject({
      seq: 2,
      nodeId: "n2",
      state: { done: true },
      nextNodeId: null,
      continued: true,
    });
    await repo.finishRun({
      runId: "run-1",
      status: "completed",
      state: { done: true },
      trace: [{ nodeId: "n1", type: "step", status: "ok", ms: 5 }],
      error: null,
      finishedAt: new Date(),
    });
    const run = (
      await pool.query(`select status, state, finished_at from flow_runs where id = 'run-1'`)
    ).rows[0];
    expect(run.status).toBe("completed");
    expect(run.state).toEqual({ done: true });
    expect(run.finished_at).not.toBeNull();
  });

  it("EngineThreadStateRepository upserts one state row per thread", async () => {
    const repo = new EngineThreadStateRepository(database);
    await seedThread("t-1");
    await repo.upsert({
      values: { threadId: "t-1", category: "fyi", action: "none", priority: 1 },
      set: { category: "fyi", action: "none", priority: 1 },
    });
    await repo.upsert({
      values: { threadId: "t-1", category: "needs_reply", action: "reply", priority: 90 },
      set: { category: "needs_reply", action: "reply", priority: 90 },
    });
    const rows = await pool.query(`select * from thread_states where thread_id = 't-1'`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ category: "needs_reply", priority: 90 });
  });
});

describe("Mailbox/Thread/Message repositories (Gmail mirror)", () => {
  it("upserts a mailbox idempotently and advances its cursors", async () => {
    const repo = new MailboxRepository(database);
    const first = await repo.upsert({
      id: "mb-ignored",
      userId: "user-1",
      email: "me@test.local",
      historyId: "h1",
    });
    expect(first.id).toBe("mb-1"); // (userId,email) conflict keeps the original id
    expect(first.historyId).toBe("h1");
    const second = await repo.upsert({
      id: "mb-ignored-2",
      userId: "user-1",
      email: "me@test.local",
      historyId: "h2",
    });
    expect(second.id).toBe("mb-1");
    expect(second.historyId).toBe("h2");
    expect((await repo.findByEmail("ME@TEST.LOCAL"))?.id).toBe("mb-1");
    expect((await repo.findByIdForUser("user-1", "mb-1"))?.email).toBe("me@test.local");
    expect(await repo.findByIdForUser("user-2", "mb-1")).toBeUndefined();

    await repo.updateWatch({
      mailboxId: "mb-1",
      expiration: new Date("2026-03-01T00:00:00Z"),
    });
    expect((await repo.findByUser("user-1"))?.watchExpiration).toBeInstanceOf(Date);
    await repo.updateSyncCursor({
      mailboxId: "mb-1",
      historyId: "h3",
      lastSyncedAt: new Date("2026-01-05T00:00:00Z"),
    });
    expect((await repo.findByUser("user-1"))?.historyId).toBe("h3");
  });

  it("mirrors threads and messages idempotently", async () => {
    const threads = new ThreadRepository(database);
    const messageRepo = new MessageRepository(database);
    const thread = await threads.upsertMirrored({
      id: "t-1",
      mailboxId: "mb-1",
      userId: "user-1",
      gmailThreadId: "g-1",
      subject: "First",
      lastMessageAt: new Date("2026-01-01T00:00:00Z"),
      labels: ["INBOX"],
      isUnread: true,
    });
    expect(thread.id).toBe("t-1");
    const again = await threads.upsertMirrored({
      id: "t-ignored",
      mailboxId: "mb-1",
      userId: "user-1",
      gmailThreadId: "g-1",
      subject: "Updated",
      lastMessageAt: new Date("2026-01-01T00:00:00Z"),
      labels: ["INBOX", "STARRED"],
      isUnread: false,
    });
    expect(again.id).toBe("t-1");
    expect((await pool.query(`select subject, is_unread from threads where id = 't-1'`)).rows[0]).toMatchObject({
      subject: "Updated",
      is_unread: false,
    });

    const msg = await messageRepo.upsertMirrored({
      id: "m-1",
      threadId: "t-1",
      gmailMessageId: "gm-1",
      direction: "inbound",
      fromAddr: "a@x.com",
      toAddr: ["me@test.local"],
      subject: "First",
      bodyText: "hello",
      bodyHtml: null,
      snippet: "hello",
      unsubscribe: null,
      sentAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(msg.id).toBe("m-1");
    await messageRepo.upsertMirrored({
      id: "m-ignored",
      threadId: "t-1",
      gmailMessageId: "gm-1",
      direction: "inbound",
      fromAddr: "a@x.com",
      toAddr: ["me@test.local"],
      subject: "First",
      bodyText: "edited",
      bodyHtml: null,
      snippet: "edited",
      unsubscribe: null,
      sentAt: new Date("2026-01-01T00:00:00Z"),
    });
    const messages = await pool.query(`select id, body_text from messages where gmail_message_id = 'gm-1'`);
    expect(messages.rows).toHaveLength(1);
    expect(messages.rows[0].body_text).toBe("edited");
  });
});

describe("MeetingRepository", () => {
  it("lists meetings starting in a window and counts by created window", async () => {
    const repo = new MeetingRepository(database);
    await seedThread("t-1");
    await pool.query(
      `insert into meetings (id, user_id, thread_id, start_at, created_at)
       values ('mt-in','user-1','t-1', now() + interval '1 day', now()),
              ('mt-out','user-1','t-1', now() + interval '40 days', now())`,
    );
    const inWindow = await repo.listStartingBetween({
      userId: "user-1",
      from: new Date(),
      to: new Date(Date.now() + 7 * 86_400_000),
      limit: 10,
    });
    expect(inWindow.map((m) => m.id)).toEqual(["mt-in"]);
    expect(
      await repo.countCreatedSince("user-1", new Date(Date.now() - 86_400_000)),
    ).toBe(2);
  });
});

describe("ActivityRepository", () => {
  it("reads the calendar timezone, draft mix and JSONB tool usage", async () => {
    const repo = new ActivityRepository(database);
    await pool.query(
      `insert into onboarding_state (user_id, calendar_timezone) values ('user-1','Europe/Paris')`,
    );
    expect(await repo.findCalendarTimezone("user-1")).toBe("Europe/Paris");
    expect(await repo.findCalendarTimezone("user-2")).toBeNull();

    const since = new Date(Date.now() - 86_400_000);
    await seedThread("t-1");
    await pool.query(
      `insert into drafts (id, user_id, thread_id, body, status)
       values ('d-1','user-1','t-1','a','pending'),
              ('d-2','user-1','t-1','b','sent')`,
    );
    const mix = await repo.countDraftsByStatusSince({ userId: "user-1", since });
    expect(mix).toEqual(
      expect.arrayContaining([
        { status: "pending", n: 1 },
        { status: "sent", n: 1 },
      ]),
    );

    await pool.query(
      `insert into agent_runs (id, user_id, conversation_id, request_id, trace)
       values ('run-1','user-1','thread-chat','req-1',
               '[{"step":1,"kind":"tool","toolName":"search_emails","status":"ok","ms":1},
                 {"step":2,"kind":"tool","toolName":"send_email","status":"error","ms":1}]'::jsonb)`,
    );
    const tools = await repo.listToolUsage({ userId: "user-1", since, limit: 8 });
    expect(tools).toEqual(
      expect.arrayContaining([
        { name: "search_emails", calls: 1, errors: 0 },
        { name: "send_email", calls: 1, errors: 1 },
      ]),
    );
    expect(await repo.countDistinctTools("user-1")).toBe(2);
  });
});
