"use client";

import { AlertTriangle, Loader2, Pause, Play, Send, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Campaign = {
  id: string;
  name: string;
  status: string;
  template: { subject: string; body: string };
  replyPolicy: string;
  footerAddress: string | null;
  throttlePerHour: number;
};

type Stats = { total: number; byStatus: Record<string, number> };

type Recipient = {
  id: string;
  email: string;
  name: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
};

type CheckResult = {
  risk: string;
  blocked: boolean;
  issues: string[];
  suggestion: string | null;
  source: string;
};

const STATUS_ORDER = [
  "pending",
  "sent",
  "replied",
  "unsubscribed",
  "bounced",
  "failed",
  "skipped",
] as const;

export function CampaignDetail({
  campaign,
  stats,
  recipients,
  enabled,
}: {
  campaign: Campaign;
  stats: Stats;
  recipients: Recipient[];
  enabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);

  const act = async (action: string, body: Record<string, unknown> = {}) => {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/campaigns/${campaign.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const payload = (await response.json()) as {
        data?: unknown;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message || `Couldn't ${action} the campaign.`);
      }
      if (action === "test") setNotice("Test sent to your inbox.");
      if (action === "check" && payload.data) {
        setCheck((payload.data as { check: CheckResult }).check);
      }
      router.refresh();
      return payload.data;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed.");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    // Review gate: run the quality check first.
    const data = (await act("check")) as { check: CheckResult } | null;
    if (data?.check.blocked) {
      setError("The quality check blocked this send. Fix the issues and try again.");
      return;
    }
    if (!window.confirm("Send this campaign now? Emails cannot be unsent.")) return;
    await act("start", { confirm: true });
  };

  const running = campaign.status === "sending";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium capitalize text-muted-foreground">
          {campaign.status}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {stats.total} recipients · {campaign.throttlePerHour}/hr throttle · replies:{" "}
          {campaign.replyPolicy}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void act("test")} disabled={busy !== null || !enabled}>
            {busy === "test" ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Send test
          </Button>
          {!running && (campaign.status === "draft" || campaign.status === "paused") ? (
            <Button size="sm" onClick={() => void start()} disabled={busy !== null || !enabled}>
              {busy === "check" || busy === "start" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              {campaign.status === "paused" ? "Resume" : "Start"}
            </Button>
          ) : null}
          {running ? (
            <Button variant="outline" size="sm" onClick={() => void act("pause")} disabled={busy !== null}>
              <Pause className="size-3.5" />
              Pause
            </Button>
          ) : null}
          {campaign.status !== "done" && campaign.status !== "cancelled" ? (
            <Button variant="destructive" size="sm" onClick={() => void act("cancel")} disabled={busy !== null}>
              <XCircle className="size-3.5" />
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? <p className="text-xs text-emerald-500">{notice}</p> : null}

      {check && check.issues.length > 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3.5" />
            Quality check · {check.risk} risk
          </p>
          <ul className="mt-1 list-disc pl-5 text-[12px] text-amber-700 dark:text-amber-400">
            {check.issues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
          {check.suggestion ? (
            <p className="mt-1 text-[12px] text-muted-foreground">{check.suggestion}</p>
          ) : null}
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">Message</h2>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-[13px] font-medium text-foreground">
            {campaign.template.subject || "(no subject)"}
          </p>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-[12px] text-muted-foreground">
            {campaign.template.body}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">Progress</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
          {STATUS_ORDER.map((status) => (
            <div key={status} className="rounded-lg border border-border px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {status}
              </p>
              <p className="text-[15px] font-semibold tabular-nums text-foreground">
                {stats.byStatus[status] ?? 0}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Recipients ({recipients.length})
        </h2>
        <ul className="flex max-h-96 flex-col divide-y divide-border overflow-y-auto rounded-xl border border-border bg-card">
          {recipients.map((recipient) => (
            <li key={recipient.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                {recipient.name ? `${recipient.name} · ` : ""}
                {recipient.email}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                  recipient.status === "sent"
                    ? "bg-emerald-500/10 text-emerald-500"
                    : recipient.status === "failed"
                      ? "bg-rose-500/10 text-rose-500"
                      : "bg-secondary text-muted-foreground",
                )}
              >
                {recipient.status}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
