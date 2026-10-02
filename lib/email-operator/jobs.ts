import "server-only";

import type { Database } from "@/lib/db";
import { bulkSendHandler } from "@/lib/email-operator/handlers/bulk-send";
import { followupHandler } from "@/lib/email-operator/handlers/followup";
import { inboundEmailHandler } from "@/lib/email-operator/handlers/inbound-email";
import { mailboxSyncHandler } from "@/lib/email-operator/handlers/mailbox-sync";
import { scheduledEmailHandler } from "@/lib/email-operator/handlers/scheduled-email";
import type { JobRow } from "@/lib/queue/queue";

/**
 * Job-kind handler registry. The drain claims jobs and dispatches by `kind`;
 * `loadJobHandlers()` registers the built-ins (idempotent, so tests may clear
 * and re-run). Feature tests can also `registerJobHandler()` their own.
 */

export type JobContext = {
  db: Database;
  workerId: string;
};

export type JobHandler = (job: JobRow, ctx: JobContext) => Promise<void>;

const HANDLERS = new Map<string, JobHandler>();

/** Handler modules export `{ kind, handler }` so this file owns registration. */
const ALL_HANDLERS: Array<{ kind: string; handler: JobHandler }> = [
  inboundEmailHandler,
  mailboxSyncHandler,
  followupHandler,
  scheduledEmailHandler,
  bulkSendHandler,
];

export function registerJobHandler(kind: string, handler: JobHandler): void {
  HANDLERS.set(kind, handler);
}

export function getJobHandler(kind: string): JobHandler | undefined {
  return HANDLERS.get(kind);
}

export function listJobKinds(): string[] {
  return [...HANDLERS.keys()];
}

/** Test helper: forget every registered handler. */
export function clearJobHandlers(): void {
  HANDLERS.clear();
}

/** Registers every built-in handler. Safe to call repeatedly. */
export function loadJobHandlers(): void {
  for (const entry of ALL_HANDLERS) HANDLERS.set(entry.kind, entry.handler);
}
