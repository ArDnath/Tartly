import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-handler integration suite (SKILL §14.1, C3).
 *
 * Unlike the repository suites, these drive the real `withUser` wrapper end to
 * end against an ephemeral Postgres: session + rate-limit + idempotency edges
 * are stubbed (they are unit-tested elsewhere), everything below them — the
 * contract middleware, the service, the repositories, the SQL — is real. That
 * is what pins the Phase C4 status codes, C5 cursor envelopes, C1 enforcement
 * and the owner-scoping (BOLA) invariant at the HTTP boundary.
 */

const session = vi.hoisted(() => ({ userId: "user-1" }));

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: session.userId } })),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));
vi.mock("@/lib/api/idempotency", () => ({
  beginIdempotent: vi.fn(async () => ({
    kind: "run" as const,
    finish: async () => {},
  })),
  MAX_IDEMPOTENCY_KEY_LENGTH: 64,
}));

let container: StartedPostgreSqlContainer;
let pool: Pool;
let appPool: { end: () => Promise<void> };

let knowledgeRoot: typeof import("@/app/api/v1/settings/knowledge/route");
let knowledgeById: typeof import("@/app/api/v1/settings/knowledge/[id]/route");
let meetingsRoot: typeof import("@/app/api/v1/meetings/route");
let runsRoot: typeof import("@/app/api/v1/runs/route");

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  // The `@/lib/db` singleton captures `DATABASE_URL` at first import, so point
  // it at the throwaway database before the route modules are loaded.
  process.env.DATABASE_URL = container.getConnectionUri();

  pool = new Pool({ connectionString: container.getConnectionUri(), max: 5 });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });

  // Import the `@/lib/db` singleton so we can close it explicitly; a live pool
  // would otherwise keep the Vitest process alive.
  const dbModule = await import("@/lib/db");
  appPool = dbModule.pool;

  knowledgeRoot = await import("@/app/api/v1/settings/knowledge/route");
  knowledgeById = await import("@/app/api/v1/settings/knowledge/[id]/route");
  meetingsRoot = await import("@/app/api/v1/meetings/route");
  runsRoot = await import("@/app/api/v1/runs/route");
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await pool?.end();
  await container?.stop();
});

beforeEach(async () => {
  session.userId = "user-1";
  await pool.query('truncate "user" cascade');
  await pool.query(
    `insert into "user" (id, name, email)
     values ('user-1','User One','user-1@test.local'),
            ('user-2','User Two','user-2@test.local')`,
  );
});

function jsonRequest(
  url: string,
  method: string,
  body?: unknown,
): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

type Envelope<T> = { data: T; error?: { code: string; message: string } };

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("POST/GET/DELETE /api/v1/settings/knowledge", () => {
  it("creates a resource with 201 + Location and persists it", async () => {
    const created = await knowledgeRoot.POST(
      jsonRequest("/api/v1/settings/knowledge", "POST", {
        title: "Refund policy",
        content: "Refunds within 30 days.",
      }),
      {},
    );
    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toMatch(
      /^\/api\/v1\/settings\/knowledge\//,
    );
    const payload = await json<Envelope<{ entry: { id: string; title: string } }>>(
      created,
    );
    expect(payload.data.entry.title).toBe("Refund policy");

    const listed = await knowledgeRoot.GET(
      jsonRequest("/api/v1/settings/knowledge", "GET"),
      {},
    );
    expect(listed.status).toBe(200);
    const list = await json<Envelope<{ entries: { id: string }[] }>>(listed);
    expect(list.data.entries.map((e) => e.id)).toContain(
      payload.data.entry.id,
    );
  });

  it("rejects a duplicate title with 409", async () => {
    const body = { title: "Same", content: "once" };
    const first = await knowledgeRoot.POST(
      jsonRequest("/api/v1/settings/knowledge", "POST", body),
      {},
    );
    expect(first.status).toBe(201);
    const second = await knowledgeRoot.POST(
      jsonRequest("/api/v1/settings/knowledge", "POST", body),
      {},
    );
    expect(second.status).toBe(409);
    const payload = await json<Envelope<unknown>>(second);
    expect(payload.error?.code).toBe("conflict");
  });

  it("rejects a contract-invalid body with 400 before the handler", async () => {
    const response = await knowledgeRoot.POST(
      jsonRequest("/api/v1/settings/knowledge", "POST", { title: "no content" }),
      {},
    );
    expect(response.status).toBe(400);
    const payload = await json<Envelope<unknown>>(response);
    expect(payload.error?.code).toBe("validation");
  });

  it("deletes own resource with 204 and hides it afterwards", async () => {
    const created = await json<Envelope<{ entry: { id: string } }>>(
      await knowledgeRoot.POST(
        jsonRequest("/api/v1/settings/knowledge", "POST", {
          title: "Temp",
          content: "x",
        }),
        {},
      ),
    );
    const id = created.data.entry.id;

    const deleted = await knowledgeById.DELETE(
      jsonRequest(`/api/v1/settings/knowledge/${id}`, "DELETE"),
      { params: Promise.resolve({ id }) },
    );
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");

    const list = await json<Envelope<{ entries: unknown[] }>>(
      await knowledgeRoot.GET(
        jsonRequest("/api/v1/settings/knowledge", "GET"),
        {},
      ),
    );
    expect(list.data.entries).toEqual([]);
  });

  it("BOLA: another owner's entry is not readable, patchable or deletable", async () => {
    const created = await json<Envelope<{ entry: { id: string } }>>(
      await knowledgeRoot.POST(
        jsonRequest("/api/v1/settings/knowledge", "POST", {
          title: "Private",
          content: "secret",
        }),
        {},
      ),
    );
    const id = created.data.entry.id;

    session.userId = "user-2";
    const list = await json<Envelope<{ entries: unknown[] }>>(
      await knowledgeRoot.GET(
        jsonRequest("/api/v1/settings/knowledge", "GET"),
        {},
      ),
    );
    expect(list.data.entries).toEqual([]);

    const patch = await knowledgeById.PATCH(
      jsonRequest(`/api/v1/settings/knowledge/${id}`, "PATCH", {
        content: "hacked",
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(patch.status).toBe(404);

    const del = await knowledgeById.DELETE(
      jsonRequest(`/api/v1/settings/knowledge/${id}`, "DELETE"),
      { params: Promise.resolve({ id }) },
    );
    expect(del.status).toBe(404);
  });
});

describe("POST /api/v1/meetings (domain validation)", () => {
  it("returns 422 when end is not after start", async () => {
    const response = await meetingsRoot.POST(
      jsonRequest("/api/v1/meetings", "POST", {
        subject: "Backwards",
        startAt: "2026-10-03T10:00:00.000Z",
        endAt: "2026-10-03T09:00:00.000Z",
      }),
      {},
    );
    expect(response.status).toBe(422);
    const payload = await json<Envelope<unknown>>(response);
    expect(payload.error?.code).toBe("validation");
  });
});

describe("GET /api/v1/runs (cursor pagination)", () => {
  async function seedRun(
    id: string,
    userId: string,
    startedAt: string,
  ): Promise<void> {
    await pool.query(
      `insert into flows (id, user_id, name, graph) values ($1,$2,$3,'{}')
       on conflict (id) do nothing`,
      [`flow-${userId}`, userId, "Test flow"],
    );
    await pool.query(
      `insert into flow_runs (id, user_id, flow_id, trigger_kind, started_at)
       values ($1,$2,$3,'manual',$4)`,
      [id, userId, `flow-${userId}`, startedAt],
    );
  }

  it("pages newest-first, is owner-scoped and emits a usable cursor", async () => {
    await seedRun("r1", "user-1", "2026-10-03T12:00:00.000Z");
    await seedRun("r2", "user-1", "2026-10-03T11:00:00.000Z");
    await seedRun("r3", "user-1", "2026-10-03T10:00:00.000Z");
    await seedRun("r-other", "user-2", "2026-10-03T13:00:00.000Z");

    const first = await runsRoot.GET(
      jsonRequest("/api/v1/runs?limit=2", "GET"),
      {},
    );
    expect(first.status).toBe(200);
    const page1 = await json<
      Envelope<{ runs: { id: string }[] }> & {
        pagination: { has_more: boolean; next_cursor: string | null };
      }
    >(first);
    expect(page1.data.runs.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(page1.pagination.has_more).toBe(true);
    expect(page1.pagination.next_cursor).toBeTruthy();

    const second = await runsRoot.GET(
      jsonRequest(
        `/api/v1/runs?limit=2&cursor=${encodeURIComponent(
          page1.pagination.next_cursor!,
        )}`,
        "GET",
      ),
      {},
    );
    const page2 = await json<
      Envelope<{ runs: { id: string }[] }> & {
        pagination: { has_more: boolean; next_cursor: string | null };
      }
    >(second);
    expect(page2.data.runs.map((r) => r.id)).toEqual(["r3"]);
    expect(page2.pagination.has_more).toBe(false);
    expect(page2.pagination.next_cursor).toBeNull();
  });

  it("clamps an out-of-range limit instead of failing", async () => {
    const response = await runsRoot.GET(
      jsonRequest("/api/v1/runs?limit=9999", "GET"),
      {},
    );
    expect(response.status).toBe(200);
  });
});
