import "server-only";

import { nanoid } from "nanoid";

import {
  type CheckpointStore,
  type FlowCheckpointRecord,
  type StoredCheckpoint,
} from "@tartly/flow-runtime";

import type { Database } from "@/lib/db";
import {
  decodeCheckpoint,
  encodeCheckpoint,
} from "@/lib/engine/checkpoint-codec";
import { EnginePersistenceRepository } from "@/lib/repositories/engine-persistence";

/**
 * Postgres implementation of the runtime's journal port.
 *
 * Kept separate from the step resolver so persistence can be imported (and
 * tested against a real database) without loading the application's whole step
 * registry. The runtime only sees the `CheckpointStore` interface.
 */
export class DatabaseCheckpointStore implements CheckpointStore {
  private readonly repository: EnginePersistenceRepository;

  constructor(database: Database) {
    this.repository = new EnginePersistenceRepository(database);
  }

  async load(runId: string): Promise<readonly StoredCheckpoint[]> {
    const rows = await this.repository.listCheckpoints(runId);
    return rows.map(decodeCheckpoint);
  }

  async append(
    runId: string,
    checkpoint: FlowCheckpointRecord,
  ): Promise<void> {
    await this.repository.insertCheckpoint({
      id: nanoid(),
      runId,
      nodeId: checkpoint.nodeId,
      status: checkpoint.status,
      output: encodeCheckpoint(checkpoint),
    });
  }
}
