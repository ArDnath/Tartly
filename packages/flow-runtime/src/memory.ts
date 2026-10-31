import type {
  CheckpointStore,
  FlowCheckpointRecord,
  StoredCheckpoint,
} from "./types";

/**
 * In-memory journal used by tests and local tooling. It implements exactly the
 * same port as the Postgres store, so replay/resume behaviour is exercised
 * without a database.
 */
export type MemoryCheckpointStore = CheckpointStore & {
  records(runId: string): readonly StoredCheckpoint[];
  reset(runId?: string): void;
};

export function createMemoryCheckpointStore(
  seed: Record<string, readonly StoredCheckpoint[]> = {},
): MemoryCheckpointStore {
  const runs = new Map<string, StoredCheckpoint[]>(
    Object.entries(seed).map(([runId, records]) => [
      runId,
      records.map((record) => ({ ...record })),
    ]),
  );

  return {
    async load(runId: string): Promise<readonly StoredCheckpoint[]> {
      return (runs.get(runId) ?? []).map((record) => ({ ...record }));
    },
    async append(
      runId: string,
      checkpoint: FlowCheckpointRecord,
    ): Promise<void> {
      const records = runs.get(runId) ?? [];
      records.push({ ...checkpoint });
      runs.set(runId, records);
    },
    records(runId: string): readonly StoredCheckpoint[] {
      return (runs.get(runId) ?? []).map((record) => ({ ...record }));
    },
    reset(runId?: string): void {
      if (runId) runs.delete(runId);
      else runs.clear();
    },
  };
}
