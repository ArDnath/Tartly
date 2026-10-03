import "server-only";

import { AuthenticationError, ValidationError } from "@/lib/agent/errors";
import { enrollThread } from "@/lib/followup/service";
import {
  ThreadRepository,
  threadRepository,
} from "@/lib/repositories/threads";

/**
 * FollowupService — the agent-facing entry to the follow-up cadence.
 *
 * Follow-ups live on the mirrored thread model (`followup_enrollments`
 * references `threads.id`), while the agent reads live Gmail. So this service
 * bridges the two by Gmail thread id: it resolves the mirrored thread
 * owner-scoped, then reuses `enrollThread`. A thread that has not been synced
 * yet returns a clear "not available" rather than silently creating a
 * half-mirrored row.
 */

export interface CreateFollowupInput {
  userId: string;
  /** The Gmail thread id (from search_emails / get_thread). */
  gmailThreadId: string;
  afterDays?: number;
  maxAttempts?: number;
}

export type CreateFollowupResult =
  | {
      enrolled: true;
      enrollmentId: string;
      threadId: string;
      nextEvalAt: string | null;
      notice: string;
    }
  | {
      enrolled: false;
      reason: "not_synced" | "unreachable";
      threadId: string | null;
      notice: string;
    };

export const DEFAULT_FOLLOWUP_AFTER_DAYS = 3;

export class FollowupService {
  constructor(private readonly threads: ThreadRepository = threadRepository) {}

  async createFollowup(input: CreateFollowupInput): Promise<CreateFollowupResult> {
    if (!input.userId) throw new AuthenticationError();
    const gmailThreadId = input.gmailThreadId?.trim();
    if (!gmailThreadId) {
      throw new ValidationError("A thread id is required to start a follow-up.");
    }
    const afterDays = clampDays(input.afterDays);
    const maxAttempts = clampAttempts(input.maxAttempts);

    const mirror = await this.threads.findByGmailThreadIdForUser(
      input.userId,
      gmailThreadId,
    );

    if (!mirror) {
      return {
        enrolled: false,
        reason: "not_synced",
        threadId: null,
        notice:
          "This conversation has not been synced into the follow-up engine yet, so a cadence cannot be started. It will work once the mailbox sync has seen the thread.",
      };
    }

    const enrollment = await enrollThread({
      userId: input.userId,
      threadId: mirror.id,
      afterDays,
      maxAttempts,
    });

    if (!enrollment) {
      return {
        enrolled: false,
        reason: "unreachable",
        threadId: mirror.id,
        notice:
          "The other side of this thread is an automated address or has no replyable sender, so a follow-up would not be delivered.",
      };
    }

    return {
      enrolled: true,
      enrollmentId: enrollment.id,
      threadId: mirror.id,
      nextEvalAt: enrollment.nextEvalAt?.toISOString() ?? null,
      notice:
        "Follow-up scheduled. A nudge draft will appear for you to approve; nothing is sent automatically.",
    };
  }
}

function clampDays(value: number | undefined): number {
  if (value === undefined) return DEFAULT_FOLLOWUP_AFTER_DAYS;
  if (!Number.isFinite(value)) return DEFAULT_FOLLOWUP_AFTER_DAYS;
  return Math.min(Math.max(Math.round(value), 1), 30);
}

function clampAttempts(value: number | undefined): number {
  if (value === undefined) return 3;
  if (!Number.isFinite(value)) return 3;
  return Math.min(Math.max(Math.round(value), 1), 5);
}

export const followupService = new FollowupService();
