"use client";

import { ArrowLeft, Inbox as InboxIcon, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { DraftCard } from "@/components/inbox/draft-card";
import { MeetingCard } from "@/components/inbox/meeting-card";
import { ThreadSummary } from "@/components/inbox/thread-summary";
import { ScopedAutonomySwitch } from "@/components/assistant/scoped-autonomy";
import { Button } from "@/components/ui/button";
import type { ThreadDetail } from "@/lib/inbox/service";
import { cn } from "@/lib/utils";

function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initials(value: string | null): string {
  const source = (value ?? "").split("@")[0];
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "@";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function ThreadView({ detail }: { detail: ThreadDetail }) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (action: () => Promise<Response>, success: string) => {
    setIsBusy(true);
    setNotice(null);
    try {
      const response = await action();
      if (!response.ok) throw new Error("Request failed");
      setNotice(success);
      router.refresh();
    } catch (error) {
      console.error("[inbox] action failed", error);
      setNotice("Something went wrong. Try again.");
    } finally {
      setIsBusy(false);
    }
  };

  const approve = (body: string) =>
    run(
      () =>
        fetch(`/api/v1/drafts/${detail.draft?.id}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ editedBody: body }),
        }),
      "Reply sent.",
    );

  const discard = () =>
    run(
      () =>
        fetch(`/api/v1/drafts/${detail.draft?.id}/discard`, {
          method: "POST",
        }),
      "Draft discarded.",
    );

  const regenerate = () =>
    run(
      () =>
        fetch(`/api/v1/inbox/${detail.thread.id}/draft`, { method: "POST" }),
      "Draft regenerated.",
    );

  const lastInbound = [...detail.messages]
    .reverse()
    .find((message) => message.direction === "inbound");

  const unsubscribe = () =>
    run(
      () =>
        fetch("/api/v1/mail/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            senderEmail: lastInbound?.from ?? detail.senderProfile?.email,
            threadId: detail.thread.id,
          }),
        }),
      "Unsubscribe requested.",
    );

  const showUnsubscribe =
    detail.senderProfile &&
    (detail.senderProfile.unsubscribeMethod ||
      detail.senderProfile.category === "Newsletters" ||
      detail.senderProfile.category === "Marketing" ||
      detail.senderProfile.coldEmailScore >= 70);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <Link
          href="/inbox"
          aria-label="Back to inbox"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight text-foreground">
          {detail.thread.subject ?? "(no subject)"}
        </h1>
        {detail.senderProfile ? (
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
              detail.senderProfile.coldEmailScore >= 70
                ? "border-foreground/30 text-foreground"
                : "border-border text-muted-foreground",
            )}
            title={
              detail.senderProfile.coldEmailScore >= 70
                ? "Flagged as cold outreach"
                : undefined
            }
          >
            {detail.senderProfile.coldEmailScore >= 70
              ? "Cold"
              : detail.senderProfile.category}
          </span>
        ) : null}
        {detail.state?.category ? (
          <span
            className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
            title={detail.state.reason ?? undefined}
          >
            {detail.state.category.replace(/_/g, " ")}
          </span>
        ) : null}
        <ScopedAutonomySwitch threadId={detail.thread.id} />
        {showUnsubscribe ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={unsubscribe}
            disabled={isBusy}
            className="shrink-0 text-muted-foreground"
          >
            Unsubscribe
          </Button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col px-6 py-5">
          <div className="pb-4">
            <ThreadSummary
              threadId={detail.thread.id}
              canSummarize={detail.canSummarize}
            />
          </div>

          {detail.messages.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <InboxIcon className="size-4 text-muted-foreground" />
              <p className="text-[13px] text-muted-foreground">
                No messages mirrored for this thread yet.
              </p>
            </div>
          ) : (
            detail.messages.map((message) => {
              const outbound = message.direction === "outbound";
              return (
                <article
                  key={message.id}
                  className="flex gap-3 border-b border-border py-4 last:border-b-0"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
                      outbound
                        ? "bg-foreground text-background"
                        : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {outbound ? "You" : initials(message.from)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {outbound ? "You" : (message.from ?? "Unknown")}
                      </span>
                      <span
                        suppressHydrationWarning
                        className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                      >
                        {formatDateTime(message.sentAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground/90">
                      {message.bodyText ?? ""}
                    </p>
                  </div>
                </article>
              );
            })
          )}

          {notice ? (
            <p className="py-3 text-[12px] text-muted-foreground">{notice}</p>
          ) : null}

          <div className="pt-4">
            <MeetingCard
              threadId={detail.thread.id}
              proposal={detail.proposal}
              meeting={detail.meeting}
            />
          </div>
        </div>
      </div>

      {detail.draft ? (
        <DraftCard
          key={`${detail.draft.id}:${detail.draft.editedBody ?? detail.draft.body}`}
          draft={detail.draft}
          recipient={lastInbound?.from ?? null}
          isBusy={isBusy}
          onApprove={approve}
          onDiscard={discard}
          onRegenerate={regenerate}
        />
      ) : (
        <section className="flex shrink-0 items-center justify-between border-t border-border bg-card px-5 py-3.5">
          <span className="text-[12px] text-muted-foreground">
            No draft yet for this thread.
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={regenerate}
            disabled={isBusy}
            className="gap-1.5"
          >
            {isBusy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Draft a reply
          </Button>
        </section>
      )}
    </div>
  );
}
