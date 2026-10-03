import { describe, expect, it } from "vitest";

import type { AgentContext } from "@/lib/agent/context";
import {
  createDeliverComposerDraftTool,
  DELIVER_COMPOSER_DRAFT_TOOL_NAME,
} from "@/lib/agent/tools/deliver-composer-draft";

const ctx = {
  permissions: { canRead: true },
} as unknown as AgentContext;

/**
 * The composer agent's terminal tool. It has no side effect: its only job is to
 * hand a validated, normalised draft back as the tool result, which the
 * composer reads off the streamed UI message.
 */
describe("deliver_composer_draft", () => {
  it("returns the draft with `Name <addr>` normalised to bare addresses", async () => {
    const tool = createDeliverComposerDraftTool();

    expect(tool.name).toBe(DELIVER_COMPOSER_DRAFT_TOOL_NAME);
    expect(tool.risk).toBe("READ");

    const input = tool.inputSchema.parse({
      to: ["Sattamjit Banik <Sattamjit@Example.com>", "sattamjit@example.com"],
      cc: ["Copy <copy@example.com>"],
      subject: "  Hello there  ",
      body: "  Body text  ",
    });

    await expect(tool.execute(ctx, input)).resolves.toEqual({
      to: ["sattamjit@example.com"],
      cc: ["copy@example.com"],
      bcc: [],
      subject: "Hello there",
      body: "Body text",
    });
  });

  it("allows an empty recipient list but never an empty body", () => {
    const tool = createDeliverComposerDraftTool();

    expect(tool.inputSchema.safeParse({ body: "hi" }).success).toBe(true);
    expect(tool.inputSchema.safeParse({ body: "" }).success).toBe(false);
  });

  it("rejects a recipient that is not a usable address", () => {
    const tool = createDeliverComposerDraftTool();
    const result = tool.inputSchema.safeParse({
      to: ["not an address"],
      body: "hi",
    });
    expect(result.success).toBe(false);
  });
});
