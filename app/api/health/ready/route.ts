import { NextResponse } from "next/server";

import { pingDatabase } from "@/lib/db";
import { isShuttingDown } from "@/lib/lifecycle";
import { redis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 530 per the skill's readiness contract; infra treats any 5xx as not-ready. */
const NOT_READY_STATUS = 530;
const CHECK_TIMEOUT_MS = 2_000;

type CheckResult = { status: "up" | "down"; latencyMs: number; error?: string };

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${CHECK_TIMEOUT_MS}ms`)),
        CHECK_TIMEOUT_MS,
      ),
    ),
  ]);
}

async function pingPostgres(): Promise<CheckResult> {
  const startedAt = Date.now();
  try {
    await withTimeout(pingDatabase(), "postgres");
    return { status: "up", latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      status: "down",
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function pingRedis(): Promise<CheckResult> {
  const startedAt = Date.now();
  try {
    await withTimeout(redis.ping(), "redis");
    return { status: "up", latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      status: "down",
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Readiness probe: the server is only ready when its required backing services
 * (Postgres source of truth, Redis speed layer) answer a live ping. A failed
 * check returns 530 so a load balancer stops routing new traffic here.
 */
export async function GET() {
  // During graceful shutdown (Phase D2) the instance still has in-flight work,
  // but it must stop receiving new traffic immediately: report not-ready so the
  // load balancer drains it before the listener closes.
  if (isShuttingDown()) {
    return NextResponse.json(
      { status: "not_ready", checks: {}, reason: "shutting_down" },
      {
        status: NOT_READY_STATUS,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const [postgres, redisCheck] = await Promise.all([
    pingPostgres(),
    pingRedis(),
  ]);

  const ready = postgres.status === "up" && redisCheck.status === "up";
  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      checks: { postgres, redis: redisCheck },
    },
    {
      status: ready ? 200 : NOT_READY_STATUS,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
