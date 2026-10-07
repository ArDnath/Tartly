"use client";

import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleSlashIcon,
  Loader2Icon,
  SendIcon,
  ShieldAlertIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAgentChatActions } from "@/components/app/assistant/agent-chat-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { useAgentEvents } from "@/components/app/assistant/use-agent-events";
import { AgentEmailRef } from "./email-ref";
import { asRecord, asString, asStringList, formatTimestamp } from "./shared";

/**
 * The confirmation card for an external side effect.
 *
 * The tool result persisted in the transcript carries only
 * `{ status: "confirmation_required", pendingActionId, … }` — the model *proposed*
 * the send, it did not perform it. Consent is a separate, server-verified call
 * to `/api/v1/agent/actions/[id]/confirm`. Because the card is a persisted
 * message part, it reconciles its own state from the action on mount, so a
 * reload after confirming shows the outcome instead of an actionable button.
 */

type Phase = "loading" | "pending" | "submitting" | "sent" | "cancelled" | "failed";

const TITLES: Record<string, string> = {
  send_email: "Confirm send",
  reply_to_email: "Confirm reply",
  forward_email: "Confirm forward",
  delete_email: "Confirm move to trash",
  schedule_email: "Confirm scheduled send",
};

export function EmailConfirmationCard({
  toolName,
  input,
  output,
  onSettled,
}: {
  toolName: string;
  input: unknown;
  output: unknown;
  /**
   * Called once a confirm/cancel succeeds, so a host (the dock above the
   * composer) can retire the card. Left unset in the transcript.
   */
  onSettled?: () => void;
}) {
  const result = asRecord(output);
  const args = asRecord(input) ?? {};
  const pendingActionId = asString(result?.pendingActionId);
  const isConfirmation = asString(result?.status) === "confirmation_required";

  const [phase, setPhase] = useState<Phase>(isConfirmation ? "loading" : "sent");
  const [message, setMessage] = useState<string | undefined>();
  const [resultSummary, setResultSummary] = useState<string | undefined>();
  // Bumping this re-runs the reconciliation effect ("Check again").
  const [reloadToken, setReloadToken] = useState(0);
  const { resumeAfterAction } = useAgentChatActions();
  // A decision should resume the agent at most once, even if the click is
  // repeated; the reconciliation effect must never trigger a resume on reload.
  const resumedRef = useRef(false);

  // Reconcile a persisted card against the server's source of truth. State is
  // only set after the async read resolves, never synchronously in the effect.
  useEffect(() => {
    if (!isConfirmation || !pendingActionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/v1/agent/actions/${pendingActionId}`);
        if (!response.ok) throw new Error("status unavailable");
        const payload = (await response.json()) as {
          data?: { action?: { status?: string } };
        };
        if (!cancelled) setPhase(phaseFromStatus(payload.data?.action?.status));
      } catch {
        // A status read failure must not hide the action; keep it actionable.
        if (!cancelled) setPhase("pending");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isConfirmation, pendingActionId, reloadToken]);

  // Realtime: if the same action changes elsewhere (another tab confirms it, or
  // it expires), reflect the new state without a manual refresh.
  useAgentEvents({
    enabled: isConfirmation && Boolean(pendingActionId) && phase !== "sent",
    onAction: (action) => {
      if (action.id !== pendingActionId) return;
      setPhase(phaseFromStatus(action.status));
      if (action.result) setResultSummary(summarizeResult(action.result));
    },
  });

  async function decide(decision: "confirm" | "cancel") {
    if (!pendingActionId) return;
    setPhase("submitting");
    setMessage(undefined);
    try {
      const response = await fetch(
        `/api/v1/agent/actions/${pendingActionId}/${decision}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: { result?: unknown };
        error?: { message?: string };
      };
      if (!response.ok) {
        setPhase("failed");
        setMessage(payload.error?.message ?? "That action could not be completed.");
        return;
      }
      if (decision === "cancel") {
        setPhase("cancelled");
        resume();
        onSettled?.();
        return;
      }
      setResultSummary(summarizeResult(payload.data?.result));
      setPhase("sent");
      resume();
      onSettled?.();
    } catch {
      setPhase("failed");
      setMessage("The request failed. Check your connection and try again.");
    }
  }

  /** Feed the decision back to the chat so the agent can continue the task. */
  function resume() {
    if (resumedRef.current || !pendingActionId) return;
    resumedRef.current = true;
    resumeAfterAction?.(pendingActionId);
  }

  if (!isConfirmation && !pendingActionId) return null;

  const to = asStringList(args.to);
  const cc = asStringList(args.cc);
  const bcc = asStringList(args.bcc);
  const subject = asString(args.subject);
  const body = asString(args.body);
  const messageId = asString(args.messageId);
  const sendAt = formatTimestamp(args.sendAt);
  const expiresAt = formatTimestamp(result?.expiresAt);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon(phase)}
          {TITLES[toolName] ?? "Confirm action"}
        </CardTitle>
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {to.length ? <p className="truncate">To: {to.join(", ")}</p> : null}
          {cc.length ? <p className="truncate">Cc: {cc.join(", ")}</p> : null}
          {bcc.length ? <p className="truncate">Bcc: {bcc.join(", ")}</p> : null}
          {subject ? <p className="truncate">Subject: {subject}</p> : null}
          {sendAt ? <p className="truncate">Send at: {sendAt}</p> : null}
        </div>
      </CardHeader>
      <CardContent className="gap-3">
        {body ? (
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm text-foreground/90">
            {body}
          </p>
        ) : null}

        {/* The message this action refers to, as a clickable preview. */}
        {messageId ? <AgentEmailRef email={{ id: messageId }} /> : null}

        {phase === "pending" ? (
          <p className="text-xs text-muted-foreground">
            Nothing has been sent yet.
            {expiresAt ? ` This expires ${expiresAt}.` : ""}
          </p>
        ) : null}

        {phase === "sent" ? (
          <p className="text-xs text-muted-foreground">
            {resultSummary ?? "Done."}
          </p>
        ) : null}

        {phase === "cancelled" ? (
          <p className="text-xs text-muted-foreground">
            {toolName === "delete_email"
              ? "Cancelled. Nothing was moved."
              : "Cancelled. Nothing was sent."}
          </p>
        ) : null}

        {message ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CircleAlertIcon
              className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden
            />
            {message}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          {phase === "pending" || phase === "loading" ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={phase !== "pending"}
                onClick={() => void decide("cancel")}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={phase !== "pending"}
                onClick={() => void decide("confirm")}
              >
                <SendIcon className="size-4" aria-hidden />
                {toolName === "send_email" ? "Send" : "Confirm"}
              </Button>
            </>
          ) : null}
          {phase === "submitting" ? (
            <Button type="button" size="sm" disabled>
              <Loader2Icon className="size-4 animate-spin" aria-hidden />
              Working…
            </Button>
          ) : null}
          {phase === "failed" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setReloadToken((token) => token + 1)}
            >
              Check again
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function phaseFromStatus(status: string | undefined): Phase {
  switch (status) {
    case "SUCCEEDED":
      return "sent";
    case "CANCELLED":
      return "cancelled";
    case "EXPIRED":
    case "FAILED":
      return "failed";
    default:
      return "pending";
  }
}

function icon(phase: Phase) {
  switch (phase) {
    case "sent":
      return <CircleCheckIcon className="size-4 text-emerald-500" aria-hidden />;
    case "cancelled":
      return (
        <CircleSlashIcon className="size-4 text-muted-foreground" aria-hidden />
      );
    case "failed":
      // A calm "couldn't finish" marker, never an alarming red cross.
      return (
        <CircleAlertIcon className="size-4 text-amber-500" aria-hidden />
      );
    default:
      return <ShieldAlertIcon className="size-4 text-amber-500" aria-hidden />;
  }
}

function summarizeResult(result: unknown): string | undefined {
  const record = asRecord(result);
  if (!record) return undefined;
  if (record.deduped === true) {
    return "This message was already sent; it was not sent again.";
  }
  if (record.scheduled === true) {
    return "Scheduled. It will be sent at the chosen time.";
  }
  if (record.trashed === true) {
    return "Moved to the trash. It is recoverable for 30 days.";
  }
  const to = asStringList(record.to);
  return to.length ? `Sent to ${to.join(", ")}.` : "Done.";
}
