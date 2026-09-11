import "server-only";

import { and, desc, eq, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";

import { flowRuns, mailboxes, threadStates, threads } from "@/lib/db/schema";
import { seedDefaultFlows, type FlowGraph } from "@/lib/engine/flow";
import { runFlow } from "@/lib/engine/run";
import { JOB_KIND_INBOUND_EMAIL } from "@/lib/email-operator/job-kinds";
import type { JobContext, JobHandler } from "@/lib/email-operator/jobs";
import { reactivityOnInbound } from "@/lib/followup/service";
import type { JobRow } from "@/lib/queue/queue";

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

  const mailboxRows = await ctx.db
    .select()
    .from(mailboxes)
    .where(and(eq(mailboxes.id, mailboxId), eq(mailboxes.userId, job.userId)))
    .limit(1);
  if (!mailboxRows[0]) return;

  const candidates = await ctx.db
    .select({ id: threads.id })
    .from(threads)
    .leftJoin(threadStates, eq(threadStates.threadId, threads.id))
    .where(
      and(
        eq(threads.mailboxId, mailboxId),
        or(eq(threads.isUnread, true), isNull(threadStates.threadId)),
      ),
    )
    .orderBy(desc(threads.lastMessageAt))
    .limit(MAX_THREADS_PER_RUN);

  const flow = await seedDefaultFlows(job.userId);
  const graph = flow.graph as unknown as FlowGraph;

  for (const candidate of candidates) {
    // An inbound message means they replied: stop any waiting follow-up.
    try {
      await reactivityOnInbound(candidate.id);
    } catch (error) {
      console.error(`[inbound-email] reactivity failed for ${candidate.id}`, error);
    }

    const runId = nanoid();
    const trigger = { threadId: candidate.id, mailboxId };

    await ctx.db.insert(flowRuns).values({
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
