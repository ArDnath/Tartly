import "server-only";

import { autopilotDecisionRetentionDays } from "@/lib/env";
import { eventLogRepository } from "@/lib/repositories/event-log";
import { sendLedgerRepository } from "@/lib/repositories/send-ledger";
import { pruneAutopilotDecisions } from "@/lib/settings/autopilot-usage";

/**
 * Retention jobs (T-17, §11.6). All idempotent and additive; safe to run on
 * every daily cron. Runs on a small table set so the deletes stay bounded.
 */

export type RetentionResult = {
  autopilotDecisions: number;
  eventLog: number;
  sendLedger: number;
};

const EVENT_LOG_RETENTION_DAYS = 30;
const SEND_LEDGER_RETENTION_DAYS = 90;

export async function runRetentionJobs(
  now = new Date(),
): Promise<RetentionResult> {
  const autopilotCutoff = new Date(
    now.getTime() - autopilotDecisionRetentionDays() * 24 * 60 * 60 * 1000,
  );
  const eventLogCutoff = new Date(
    now.getTime() - EVENT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const sendLedgerCutoff = new Date(
    now.getTime() - SEND_LEDGER_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const [autopilotDecisions, eventLog, sendLedger] = await Promise.all([
    pruneAutopilotDecisions(autopilotCutoff).catch(() => 0),
    eventLogRepository.deleteBefore(eventLogCutoff).catch(() => 0),
    sendLedgerRepository.deleteBefore(sendLedgerCutoff).catch(() => 0),
  ]);

  return { autopilotDecisions, eventLog, sendLedger };
}
