import "server-only";

/**
 * Shared realtime poller (Phase B).
 *
 * The SSE endpoints used to run one `setInterval` per connected client, so N
 * tabs produced N Postgres queries every interval. This class owns a **single**
 * timer per server instance and batches every subscriber's cursor into one
 * query per tick, so the DB poll rate tracks the instance count instead of the
 * number of open tabs. It stops itself when the last subscriber leaves.
 *
 * Delivery is best-effort and never trusts the stream: a subscriber that throws
 * (or a transient DB error) is dropped for that tick, not torn down.
 */
export type RealtimeSubscriber<TRow> = {
  userId: string;
  since: Date;
  deliver: (rows: TRow[]) => void;
  heartbeat: () => void;
};

export type RealtimePollerOptions<TRow> = {
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  /** Fetch changed rows for any of `userIds` newer than `since` (batched). */
  fetchSince: (input: { userIds: string[]; since: Date }) => Promise<TRow[]>;
  rowUserId: (row: TRow) => string;
  rowAt: (row: TRow) => Date | null;
};

export class RealtimePoller<TRow> {
  private readonly subscribers = new Set<RealtimeSubscriber<TRow>>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(private readonly options: RealtimePollerOptions<TRow>) {}

  /** Register a subscriber and start shared timers on first use. */
  subscribe(subscriber: RealtimeSubscriber<TRow>): () => void {
    this.subscribers.add(subscriber);
    if (!this.pollTimer) {
      this.pollTimer = setInterval(
        () => void this.tick(),
        this.options.pollIntervalMs,
      );
      this.heartbeatTimer = setInterval(
        () => {
          for (const subscriber of this.subscribers) subscriber.heartbeat();
        },
        this.options.heartbeatIntervalMs,
      );
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.subscribers.delete(subscriber);
      if (this.subscribers.size === 0) this.stop();
    };
  }

  private stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.pollTimer = null;
    this.heartbeatTimer = null;
  }

  private async tick(): Promise<void> {
    if (this.ticking || this.subscribers.size === 0) return;
    this.ticking = true;
    try {
      const subscribers = [...this.subscribers];
      const userIds = [...new Set(subscribers.map((sub) => sub.userId))];
      const minSince = new Date(
        Math.min(...subscribers.map((sub) => sub.since.getTime())),
      );

      const rows = await this.options.fetchSince({ userIds, since: minSince });

      const byUser = new Map<string, TRow[]>();
      for (const row of rows) {
        const rowUserId = this.options.rowUserId(row);
        const list = byUser.get(rowUserId);
        if (list) list.push(row);
        else byUser.set(rowUserId, [row]);
      }

      for (const subscriber of subscribers) {
        const candidates = byUser.get(subscriber.userId);
        if (!candidates?.length) continue;

        const fresh: TRow[] = [];
        let latest: Date | null = null;
        for (const row of candidates) {
          const at = this.options.rowAt(row);
          if (!at || at.getTime() <= subscriber.since.getTime()) continue;
          fresh.push(row);
          if (!latest || at.getTime() > latest.getTime()) latest = at;
        }
        if (fresh.length === 0 || !latest) continue;

        try {
          subscriber.deliver(fresh);
          subscriber.since = latest;
        } catch {
          // A dead subscriber is cleaned up by its own abort/cancel path.
        }
      }
    } catch {
      // A transient DB error must not tear down the stream.
    } finally {
      this.ticking = false;
    }
  }
}
