import "server-only";

import {
  listThreadActivitySinceMany,
  type ThreadActivityWithUser,
} from "@/lib/email-operator/activity";
import {
  actionService,
  type PendingAction,
} from "@/lib/services/action-service";

import { RealtimePoller } from "./poller";

/**
 * Process-wide realtime pollers (Phase B).
 *
 * Stashed on `globalThis` so a dev-mode hot reload reuses the same instance
 * instead of leaking another interval. One poller serves every subscriber on
 * this server instance for its stream, batching their cursors into one query
 * per tick.
 */

const POLL_INTERVAL_MS = 3_000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const ROWS_PER_USER = 50;

type RealtimeGlobals = {
  __agentEventPoller?: RealtimePoller<PendingAction>;
  __mailEventPoller?: RealtimePoller<ThreadActivityWithUser>;
};

const globals = globalThis as unknown as RealtimeGlobals;

export const agentEventPoller =
  globals.__agentEventPoller ??
  (globals.__agentEventPoller = new RealtimePoller<PendingAction>({
    pollIntervalMs: POLL_INTERVAL_MS,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    fetchSince: ({ userIds, since }) =>
      actionService.listUpdatedSinceMany({
        userIds,
        since,
        limitPerUser: ROWS_PER_USER,
      }),
    rowUserId: (row) => row.userId,
    rowAt: (row) => row.updatedAt,
  }));

export const mailEventPoller =
  globals.__mailEventPoller ??
  (globals.__mailEventPoller = new RealtimePoller<ThreadActivityWithUser>({
    pollIntervalMs: POLL_INTERVAL_MS,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    fetchSince: ({ userIds, since }) =>
      listThreadActivitySinceMany({
        userIds,
        since,
        limitPerUser: ROWS_PER_USER,
      }),
    rowUserId: (row) => row.userId,
    rowAt: (row) => row.lastMessageAt,
  }));
