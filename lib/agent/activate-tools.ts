import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import {
  ACTIVATE_TOOLS_TOOL_NAME,
  CORE_GROUP,
  TOOL_GROUPS,
  TOOL_GROUP_DESCRIPTIONS,
  type ToolGroup,
} from "@/lib/agent/tool-groups";

/**
 * The `activate_tools` control tool (Phase 0, §5.3).
 *
 * When progressive disclosure is on, the model starts with core read/search
 * tools only. This tool unlocks a capability group for the rest of the turn.
 * It has no side effect — it only widens the set of callable tools — so it is
 * a READ tool and never requires confirmation. The description is
 * self-contained (§14.2): it lists the groups, says when to use it, and states
 * explicitly that unlocking is not itself an action.
 */

const Input = z.object({
  groups: z.array(z.enum(TOOL_GROUPS)).min(1),
});

export type ActivateToolInput = z.infer<typeof Input>;

export type ActivateResult = {
  /** Groups unlocked by this call (excludes already-active ones). */
  activated: ToolGroup[];
  /** Tool names that are callable now. */
  nowAvailable: string[];
};

/** Build the model-facing description from the catalog, so it cannot drift. */
export function buildActivateToolsDescription(): string {
  const unlockable = TOOL_GROUPS.filter((group) => group !== CORE_GROUP);
  return [
    "Unlock additional tools for the rest of this turn. Core search/read/thread/contact tools are always available; the rest start hidden to keep each request small.",
    "Call this once, with the groups you need, before using a capability you cannot see — for example send/reply tools (compose) or label/archive tools (organize). It only makes tools callable; it never sends or changes anything.",
    "Groups:",
    ...unlockable.map((group) => `- ${group}: ${TOOL_GROUP_DESCRIPTIONS[group]}`),
  ].join("\n");
}

/**
 * Create the definition. `activate` is supplied by the loop and records the
 * unlocked groups in its per-turn state.
 */
export function createActivateToolsDefinition({
  activate,
}: {
  activate: (groups: readonly ToolGroup[]) => ActivateResult;
}): AnyToolDefinition {
  return defineTool({
    name: ACTIVATE_TOOLS_TOOL_NAME,
    description: buildActivateToolsDescription(),
    risk: "READ",
    inputSchema: Input,
    async execute(_ctx, input) {
      const result = activate(input.groups);
      return {
        activated: result.activated,
        nowAvailable: result.nowAvailable,
        notice: result.activated.length
          ? `Unlocked ${result.activated.join(", ")}.`
          : "Those groups were already available.",
      };
    },
  });
}
