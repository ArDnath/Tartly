import "server-only";

import { nanoid } from "nanoid";

import { classifyThreadsBatch } from "@/lib/ai/features/triage";
import {
  findCampaignRecipientForReply,
  handleCampaignReply,
} from "@/lib/campaigns/service";
import { seedDefaultFlows, type FlowGraph } from "@/lib/engine/flow";
import { runFlow } from "@/lib/engine/run";
import { isCampaignsEnabled } from "@/lib/env";
import { JOB_KIND_INBOUND_EMAIL } from "@/lib/email-operator/job-kinds";
import type { JobContext, JobHandler } from "@/lib/email-operator/jobs";
import { loadThreadContext } from "@/lib/email-operator/thread-context";
import { reactivityOnInbound } from "@/lib/followup/service";
import type { JobRow } from "@/lib/queue/queue";
import { FlowRunRepository } from "@/lib/repositories/flow-runs";
import { MailboxRepository } from "@/lib/repositories/mailboxes";
import { InboundEmailRepository } from "@/lib/repositories/inbound-email";

/**
 * `inbound_email` handler: for the mailbox's unread or never-triaged threads,
 * run the default inbound-email flow. Bounded per invocation so a burst of mail
 * cannot exceed the function timeout.
 */

const MAX_THREADS_PER_RUN = 5;

async function handleInboundEmail(job: JobRow, ctx: JobContext): Promise<void> {
  const mailboxId =
    typeof job.payload.mailboxId === "string" ? job.payload.mailboxId : null;
  if (!mailboxId) return;

  const mailbox = await new MailboxRepository(ctx.db).findByIdForUser(
    job.userId,
    mailboxId,
  );
  if (!mailbox) return;

  const candidates = await new InboundEmailRepository(
    ctx.db,
  ).listTriageCandidates({
    mailboxId,
    limit: MAX_THREADS_PER_RUN,
  });

  const flow = await seedDefaultFlows(job.userId);
  const graph = flow.graph as unknown as FlowGraph;

  // One batched triage call for the whole candidate set (Phase 2): five threads
  // share a single model call instead of five. The verdict travels through the
  // trigger so the per-thread `triage` step writes it without re-classifying.
  const contexts = await Promise.all(
    candidates.map(async (candidate) => {
      const context = await loadThreadContext({
        userId: job.userId,
        threadId: candidate.id,
        historyLimit: 2,
      });
      return {
        threadId: candidate.id,
        subject: context?.thread.subject ?? null,
        body: (
          context?.latestInbound?.bodyText ??
          context?.latestInbound?.snippet ??
          ""
        ).slice(0, 4_000),
        lastDirection: context?.history.at(-1)?.direction ?? null,
      };
    }),
  );
  const classified = await classifyThreadsBatch({
    userId: job.userId,
    threads: contexts,
  });
  const triageByThread = new Map(classified.map((entry) => [entry.threadId, entry]));

  const flowRunRepository = new FlowRunRepository(ctx.db);

  for (const candidate of candidates) {
    // An inbound message means they replied: stop any waiting follow-up.
    try {
      await reactivityOnInbound(candidate.id);
    } catch (error) {
      console.error(`[inbound-email] reactivity failed for ${candidate.id}`, error);
    }

    // Phase 7: if this thread belongs to a campaign, run reply automation.
    if (isCampaignsEnabled()) {
      try {
        const context = await loadThreadContext({
          userId: job.userId,
          threadId: candidate.id,
          historyLimit: 3,
        });
        const latest = context?.latestInbound;
        const recipient = await findCampaignRecipientForReply({
          userId: job.userId,
          threadId: context?.thread.gmailThreadId ?? null,
          fromEmail: latest?.fromAddr ?? null,
        });
        if (recipient) {
          await handleCampaignReply({
            userId: job.userId,
            recipient,
            subject: latest?.subject ?? context?.thread.subject ?? null,
            body: latest?.bodyText ?? latest?.snippet ?? null,
            from: latest?.fromAddr ?? null,
            mirrorThreadId: candidate.id,
          });
        }
      } catch (error) {
        console.error(
          `[inbound-email] campaign reply handling failed for ${candidate.id}`,
          error,
        );
      }
    }

    const runId = nanoid();
    const triage = triageByThread.get(candidate.id);
    const trigger = { threadId: candidate.id, mailboxId, triage };

    await flowRunRepository.insert({
      id: runId,
      userId: job.userId,
      flowId: flow.id,
      triggerKind: "gmail_push",
      status: "running",
      state: { trigger },
    });

    try {
      await runFlow({
        runId,
        userId: job.userId,
        graph,
        trigger,
        database: ctx.db,
      });
    } catch (error) {
      console.error(
        `[inbound-email] run failed for thread ${candidate.id}`,
        error,
      );
    }
  }
}

export const inboundEmailHandler: { kind: string; handler: JobHandler } = {
  kind: JOB_KIND_INBOUND_EMAIL,
  handler: handleInboundEmail,
};
