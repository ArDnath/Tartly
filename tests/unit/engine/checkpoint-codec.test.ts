import { describe, expect, it } from "vitest";

import { CHECKPOINT_FORMAT, type FlowCheckpointRecord } from "@tartly/flow-runtime";

import {
  decodeCheckpoint,
  encodeCheckpoint,
} from "@/lib/engine/checkpoint-codec";

/**
 * The journal format is the runtime's durable contract. These tests pin the
 * current record and the legacy `{ value }` wrapper so a storage refactor
 * cannot silently break resume.
 */

const createdAt = new Date("2026-10-31T12:00:00.000Z");

const record: FlowCheckpointRecord = {
  format: CHECKPOINT_FORMAT,
  seq: 7,
  nodeId: "egress",
  nodeType: "egress",
  status: "ok",
  ms: 38,
  at: createdAt.toISOString(),
  output: { decision: "send", reason: "safe" },
  state: { trigger: "t", decision: "send" },
  nextNodeId: "send-email",
  continued: true,
};

describe("checkpoint codec", () => {
  it("round-trips a current journal record", () => {
    const decoded = decodeCheckpoint({
      nodeId: record.nodeId,
      status: record.status,
      output: encodeCheckpoint(record),
      createdAt,
    });

    expect(decoded).toEqual({
      seq: 7,
      nodeId: "egress",
      nodeType: "egress",
      status: "ok",
      ms: 38,
      at: record.at,
      output: { decision: "send", reason: "safe" },
      state: { trigger: "t", decision: "send" },
      nextNodeId: "send-email",
      continued: true,
    });
  });

  it("decodes the legacy { value } wrapper without state or routing", () => {
    const decoded = decodeCheckpoint({
      nodeId: "triage",
      status: "error",
      output: { value: { message: "soft" } },
      createdAt,
    });

    expect(decoded).toEqual({
      nodeId: "triage",
      nodeType: "unknown",
      status: "error",
      ms: 0,
      at: createdAt.toISOString(),
      output: { message: "soft" },
      continued: true,
    });
  });

  it("defaults missing v1 fields and normalizes malformed ones", () => {
    const decoded = decodeCheckpoint({
      nodeId: "partial",
      status: "ok",
      output: {
        runtime: CHECKPOINT_FORMAT,
        seq: "7",
        nodeType: 42,
        ms: "fast",
        at: 1,
        state: [],
        nextNodeId: 5,
        continued: "yes",
        value: { ok: true },
      },
      createdAt,
    });

    expect(decoded).toEqual({
      seq: undefined,
      nodeId: "partial",
      nodeType: "unknown",
      status: "ok",
      ms: 0,
      at: createdAt.toISOString(),
      output: { ok: true },
      state: undefined,
      nextNodeId: undefined,
      continued: true,
    });
  });

  it("encodes an undefined output as null", () => {
    expect(encodeCheckpoint({ ...record, output: undefined }).value).toBeNull();
  });

  it("survives malformed output and status values", () => {
    const decoded = decodeCheckpoint({
      nodeId: "broken",
      status: "unexpected",
      output: null as unknown as Record<string, unknown>,
      createdAt,
    });

    expect(decoded).toMatchObject({
      nodeId: "broken",
      status: "ok",
      output: undefined,
      nodeType: "unknown",
    });
  });
});
