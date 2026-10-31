import {
  CHECKPOINT_FORMAT,
  type FlowCheckpointRecord,
  type StoredCheckpoint,
} from "@tartly/flow-runtime";

/**
 * Journal wire format for the `flow_checkpoints.output` JSONB column.
 *
 * Encoding and decoding live in a pure module (no Drizzle, no server-only) so
 * the format is unit-testable and the runtime adapter stays a thin translation
 * layer. The decoder accepts both the current record and the original
 * `{ value }` wrapper written before the runtime existed.
 */

export type CheckpointRow = {
  nodeId: string;
  status: string;
  output: Record<string, unknown>;
  createdAt: Date;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Wraps a runtime record for storage without changing its semantics. */
export function encodeCheckpoint(
  checkpoint: FlowCheckpointRecord,
): Record<string, unknown> {
  return {
    runtime: CHECKPOINT_FORMAT,
    seq: checkpoint.seq,
    nodeId: checkpoint.nodeId,
    nodeType: checkpoint.nodeType,
    ms: checkpoint.ms,
    at: checkpoint.at,
    continued: checkpoint.continued,
    value: checkpoint.output ?? null,
    state: checkpoint.state,
    nextNodeId: checkpoint.nextNodeId,
  };
}

/** Reads a stored row back into the store-neutral runtime shape. */
export function decodeCheckpoint(row: CheckpointRow): StoredCheckpoint {
  const stored = isPlainObject(row.output) ? row.output : {};
  const status = row.status === "error" ? "error" : "ok";

  if (stored.runtime === CHECKPOINT_FORMAT) {
    return {
      seq: typeof stored.seq === "number" ? stored.seq : undefined,
      nodeId: row.nodeId,
      nodeType:
        typeof stored.nodeType === "string" ? stored.nodeType : "unknown",
      status,
      ms: typeof stored.ms === "number" ? stored.ms : 0,
      at:
        typeof stored.at === "string" ? stored.at : row.createdAt.toISOString(),
      output: stored.value,
      state: isPlainObject(stored.state) ? stored.state : undefined,
      nextNodeId:
        stored.nextNodeId === null || typeof stored.nextNodeId === "string"
          ? stored.nextNodeId
          : undefined,
      continued:
        typeof stored.continued === "boolean"
          ? stored.continued
          : status === "ok",
    };
  }

  return {
    nodeId: row.nodeId,
    nodeType: "unknown",
    status,
    ms: 0,
    at: row.createdAt.toISOString(),
    output: stored.value,
    // Earlier engines only checkpointed tolerated (best-effort) failures, so a
    // legacy error record did not stop its run. Resume must continue from it.
    continued: true,
  };
}
