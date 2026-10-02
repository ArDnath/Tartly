"use client";

import {
  getToolName,
  isToolUIPart,
  type UIMessage,
} from "ai";
import { ShieldAlertIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EmailConfirmationCard } from "@/components/assistant/cards/email-confirmation-card";
import { asRecord, asString } from "@/components/assistant/cards/shared";

/**
 * Pending approvals, docked directly above the composer.
 *
 * Approval was previously an inline card buried in the transcript, so a user
 * who had scrolled up could miss it entirely. Here the same interactive card
 * lives in a pinned tray that never scrolls with the conversation: whatever the
 * transcript is doing, "confirm this" stays in view next to the send button.
 */

export type PendingApproval = {
  id: string;
  toolName: string;
  input: unknown;
  output: unknown;
};

/** Find side effects the server has parked as pending actions in the messages. */
export function collectPendingApprovals(messages: UIMessage[]): PendingApproval[] {
  const found: PendingApproval[] = [];
  const seen = new Set<string>();

  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue;
      if (part.state !== "output-available") continue;

      const output = asRecord(part.output);
      if (asString(output?.status) !== "confirmation_required") continue;

      const id = asString(output?.pendingActionId);
      if (!id || seen.has(id)) continue;

      seen.add(id);
      found.push({
        id,
        toolName: getToolName(part),
        input: part.input,
        output: part.output,
      });
    }
  }

  return found;
}

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"]);

export function ApprovalDock({
  approvals,
}: {
  approvals: PendingApproval[];
}) {
  const [settled, setSettled] = useState<Record<string, true>>({});
  const ids = approvals.map((approval) => approval.id).join(",");

  // The transcript only says "this was proposed"; the server owns whether it is
  // still open. Probe each candidate once so a card confirmed in another tab
  // (or expired) drops out of the tray instead of lingering as actionable.
  useEffect(() => {
    if (approvals.length === 0) return;
    let cancelled = false;
    void Promise.all(
      approvals.map(async (approval) => {
        try {
          const response = await fetch(
            `/api/v1/agent/actions/${approval.id}`,
            { cache: "no-store" },
          );
          if (!response.ok) return null;
          const payload = (await response.json()) as {
            data?: { action?: { status?: string } };
          };
          return { id: approval.id, status: payload.data?.action?.status };
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setSettled((current) => {
        let changed = false;
        const next = { ...current };
        for (const result of results) {
          if (
            result?.status &&
            TERMINAL.has(result.status) &&
            !next[result.id]
          ) {
            next[result.id] = true;
            changed = true;
          }
        }
        // Return the same reference when nothing settled: a fresh object here
        // would count as a state change on every probe and re-render the dock
        // for no reason.
        return changed ? next : current;
      });
    });
    return () => {
      cancelled = true;
    };
    // Re-probe only when the set of candidate ids changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const settle = useCallback((id: string) => {
    setSettled((current) => ({ ...current, [id]: true }));
  }, []);

  const visible = approvals.filter((approval) => !settled[approval.id]);
  if (visible.length === 0) return null;

  return (
    <section
      aria-label="Actions awaiting approval"
      className="mb-2 rounded-xl border border-border bg-card p-2 shadow-sm"
    >
      <header className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-medium text-foreground">
        <ShieldAlertIcon
          className="size-3.5 text-amber-600 dark:text-amber-400"
          aria-hidden
        />
        {visible.length === 1
          ? "1 action needs your approval"
          : `${visible.length} actions need your approval`}
      </header>
      <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
        {visible.map((approval) => (
          <EmailConfirmationCard
            key={approval.id}
            toolName={approval.toolName}
            input={approval.input}
            output={approval.output}
            onSettled={() => settle(approval.id)}
          />
        ))}
      </div>
    </section>
  );
}
