import "server-only";

import { z } from "zod";

import {
  classifyColdEmail,
  deterministicColdEmailVerdict,
  heuristicColdEmailScore,
  type ColdEmailDecision,
} from "@/lib/ai/features/cold-email";
import {
  categorizeSendersBatch,
  heuristicCategorizeSender,
} from "@/lib/ai/features/categorize-sender";
import { getAssistantSettings } from "@/lib/ai/features/draft-context";
import {
  clampScore,
  getSenderProfile,
  hasPriorOutboundTo,
  isNoiseCategory,
  marketingScoreFromHeaders,
  normalizeSenderEmail,
  senderDomain,
  upsertSenderProfile,
} from "@/lib/ai/features/sender-profiles";
import {
  type MessageUnsubscribeInfo,
  type SenderCategory,
} from "@/lib/db/schema";
import { defineStep } from "@/lib/engine/step";
import {
  isColdEmailBlockerEnabled,
  isSenderCategorizationEnabled,
  isSenderIntelligenceEnabled,
} from "@/lib/env";
import { loadThreadContext } from "@/lib/email-operator/thread-context";
import {
  applyLabelUnified,
  setArchivedUnified,
} from "@/lib/mail/unified";
import { mailboxRepository } from "@/lib/repositories/mailboxes";
import { messageRepository } from "@/lib/repositories/messages";
import { requireThreadId } from "./helpers";

/**
 * Sender intelligence (Phase 2, best-effort).
 *
 * Runs after `load-context` and attaches a sender profile to the run state so
 * drafting and the UI can see "who is this / is it noise". Deterministic header
 * signals are resolved first; a model is consulted only for genuinely new,
 * unknown senders — and only once, because the result is cached on the profile.
 *
 * Best-effort by design: any failure leaves the thread processing unaffected.
 */

export type SenderIntelOutput = {
  senderProfile: {
    email: string;
    category: SenderCategory;
    confidence: number;
    coldEmailScore: number;
    isCold: boolean;
    reason: string;
    status: string;
    fromCache: boolean;
  } | null;
};

export const senderIntelStep = defineStep({
  type: "sender-intel",
  policy: "best_effort",
  configSchema: z.object({
    applyActions: z.boolean().optional(),
  }),
  async run(ctx): Promise<SenderIntelOutput> {
    const threadId = requireThreadId(ctx);

    if (!isSenderIntelligenceEnabled()) return { senderProfile: null };

    const settings = await getAssistantSettings(ctx.userId);
    if (!settings.senderIntelEnabled) return { senderProfile: null };

    const context = await loadThreadContext({
      userId: ctx.userId,
      threadId,
      historyLimit: 3,
    });
    const senderEmail = context?.latestInbound?.fromAddr;
    if (!senderEmail) return { senderProfile: null };

    const email = normalizeSenderEmail(senderEmail);
    const existing = await getSenderProfile({ userId: ctx.userId, email });

    // Cached, model-enriched profile: free to reuse forever.
    if (existing?.modelEnriched) {
      return {
        senderProfile: {
          email,
          category: existing.category,
          confidence: existing.confidence,
          coldEmailScore: existing.coldEmailScore,
          isCold: existing.coldEmailScore >= 70,
          reason: "cached sender profile",
          status: existing.status,
          fromCache: true,
        },
      };
    }

    const unsubscribe: MessageUnsubscribeInfo | null =
      context?.latestInbound?.unsubscribe ?? null;
    const marketingScore = marketingScoreFromHeaders(unsubscribe);
    const knownContact = Boolean(context?.contact);
    const priorOutbound = await hasPriorOutboundTo({
      userId: ctx.userId,
      email,
    });

    const ownerEmail = await mailboxRepository.findEmailByIdForUser({
      mailboxId: context!.thread.mailboxId,
      userId: ctx.userId,
    });
    const ownerDomain = senderDomain(ownerEmail ?? "");
    const domain = senderDomain(email);
    const isSameOrg = Boolean(ownerDomain) && ownerDomain === domain;

    const signals = {
      email,
      domain,
      fromName: context?.contact?.name ?? null,
      subject: context?.latestInbound?.subject ?? null,
      body: context?.latestInbound?.bodyText ?? context?.latestInbound?.snippet ?? "",
      isKnownContact: knownContact,
      hasPriorOutbound: priorOutbound,
      isSameOrg,
      unsubscribe,
      status: existing?.status ?? null,
    } as const;

    // Cold-email verdict: deterministic guards first, model only if unknown.
    let cold: ColdEmailDecision;
    const deterministic = deterministicColdEmailVerdict(signals);
    if (deterministic) {
      cold = deterministic;
    } else if (isColdEmailBlockerEnabled()) {
      cold = await classifyColdEmail({ userId: ctx.userId, signals });
    } else {
      cold = {
        score: heuristicColdEmailScore(signals),
        isCold: false,
        deterministic: true,
        reason: "cold blocker disabled",
      };
    }

    // Categorize only genuinely-new/unknown senders with a model.
    const isUnknown = !priorOutbound && !knownContact;
    let category: SenderCategory;
    let confidence: number;
    let usedModel = !cold.deterministic;

    if (isUnknown && isSenderCategorizationEnabled()) {
      const [result] = await categorizeSendersBatch({
        userId: ctx.userId,
        senders: [
          {
            email,
            domain,
            fromName: signals.fromName,
            marketingScore,
            isCold: cold.isCold,
          },
        ],
      });
      category = result?.category ?? "Other";
      confidence = result?.confidence ?? 0;
      if (result?.source === "model") usedModel = true;
    } else {
      const heuristic = heuristicCategorizeSender({
        email,
        domain,
        fromName: signals.fromName,
        marketingScore,
        isCold: cold.isCold,
      });
      category = heuristic.category;
      confidence = heuristic.confidence;
    }

    const profile = await upsertSenderProfile({
      userId: ctx.userId,
      email,
      patch: {
        domain,
        category,
        confidence: clampScore(confidence),
        coldEmailScore: clampScore(cold.score),
        marketingScore,
        unsubscribeUrl: unsubscribe?.url ?? unsubscribe?.mailto ?? null,
        unsubscribeMethod: unsubscribe
          ? unsubscribe.oneClick
            ? "one-click"
            : unsubscribe.mailto
              ? "mailto"
              : "link"
          : null,
        modelEnriched: usedModel,
      },
    });

    // Optional, user-configured actions. Never delete; never spam.
    if (ctx.input.applyActions !== false && !existing?.modelEnriched) {
      const ids = await messageRepository.listGmailIdsByThread(threadId);
      try {
        if (cold.isCold && settings.coldEmailAction === "label" && ids.length) {
          await applyLabelUnified(ctx.userId, ids, "Cold Email");
        } else if (
          (cold.isCold && settings.coldEmailAction === "archive") ||
          (isNoiseCategory(category) && settings.autoArchiveNoise)
        ) {
          if (ids.length) await setArchivedUnified(ctx.userId, ids, true);
        }
      } catch (error) {
        ctx.log("sender-intel:action-failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    ctx.log("sender-intel", {
      email,
      category,
      coldEmailScore: profile.coldEmailScore,
      isCold: cold.isCold,
    });

    return {
      senderProfile: {
        email,
        category,
        confidence: profile.confidence,
        coldEmailScore: profile.coldEmailScore,
        isCold: cold.isCold,
        reason: cold.reason,
        status: profile.status,
        fromCache: false,
      },
    };
  },
});
