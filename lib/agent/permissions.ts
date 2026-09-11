import type { AgentContext } from "@/lib/agent/context";
import type { ToolRisk } from "@/lib/agent/registry";

/**
 * Deterministic permission engine.
 *
 * The LLM never decides whether a tool may run. Given the server-built
 * `AgentContext` and a tool's fixed risk level, this returns one of:
 *
 *   allow                → execute now
 *   require_confirmation → do not execute; create a pending action instead
 *   deny                 → refuse, with a reason the model may relay
 *
 * Risk policy (Phase 1):
 *   READ                  auto
 *   WRITE                 auto — these are reversible mailbox mutations
 *   EXTERNAL_SIDE_EFFECT  denied until the confirmation subsystem ships. When
 *                         it does, side effects become `require_confirmation`
 *                         unless an explicit autonomy grant is present.
 */

export type PermissionDecision =
  | { kind: "allow" }
  | { kind: "require_confirmation"; reason: string }
  | { kind: "deny"; reason: string };

export interface PermissionTarget {
  name: string;
  risk: ToolRisk;
}

export function decideToolPermission(
  ctx: AgentContext,
  tool: PermissionTarget,
): PermissionDecision {
  switch (tool.risk) {
    case "READ":
      return ctx.permissions.canRead
        ? { kind: "allow" }
        : { kind: "deny", reason: "Reading mail is not permitted for this account." };

    case "WRITE":
      return ctx.permissions.canWrite
        ? { kind: "allow" }
        : { kind: "deny", reason: "Changing mail is not permitted for this account." };

    case "EXTERNAL_SIDE_EFFECT": {
      if (!ctx.permissions.canSend) {
        return {
          kind: "deny",
          reason:
            "Sending or deleting mail is not enabled yet. This capability arrives with the confirmation flow.",
        };
      }
      if (
        ctx.permissions.allowAutonomousSideEffects &&
        ctx.permissions.autonomy === "autopilot"
      ) {
        return { kind: "allow" };
      }
      return {
        kind: "require_confirmation",
        reason:
          "This action has an effect outside your mailbox and needs your explicit confirmation.",
      };
    }
  }
}
