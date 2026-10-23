"use client";

import {
  CalendarCheck,
  CircleX,
  MailCheck,
  Mails,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { usePaywallStore } from "@/components/app/paywall/paywall-store";
import { TartlyAgentLogo } from "@/components/shared/brand/tartly-logo";
import { Button } from "@/components/ui/button";
import { BILLING_PLAN } from "@/lib/billing/plans";
import type { PaywallReason } from "@/lib/billing/paywall-types";
import { cn } from "@/lib/utils";

/**
 * The paywall card: a squared, translucent glass panel built on the app's
 * instrument-panel geometry — corner registration marks, hairline rules and
 * small line icons in place of the old square glyphs. There are no grids and no
 * gradients; hierarchy is drawn with 1px rules and low-alpha fills, so the mail
 * client stays legible behind the glass. Presentation only — the store owns
 * state and `/checkout` owns payment.
 */

const REASON_COPY: Record<
  PaywallReason,
  { eyebrow: string; title: string; body: string }
> = {
  ai: {
    eyebrow: "AI is a Professional feature",
    title: "Unlock your AI email operator",
    body: "Triage, drafts, the agent, summaries and automations are included with Tartly Professional. Subscribe to switch them on.",
  },
  mail_view: {
    eyebrow: "Free reading limit reached",
    title: "See your whole inbox",
    body: "Free accounts can open five emails. Subscribe to read everything, forever.",
  },
  mail_send: {
    eyebrow: "Free sending limit reached",
    title: "Keep the conversation going",
    body: "Free accounts can send five emails. Subscribe to send and reply without limits.",
  },
  accounts: {
    eyebrow: "Multiple inboxes are a Professional feature",
    title: "Connect Gmail and Outlook together",
    body: "Tartly Professional merges every inbox into one place. Subscribe to connect a second account and see all your mail together.",
  },
  credits: {
    eyebrow: "Your AI credits are used up",
    title: "Top up to keep the operator running",
    body: "You have used your AI credits for this period. Buy a top-up pack to keep triage, drafts and the agent working — credits never expire.",
  },
};

const FEATURES: { label: string; icon: LucideIcon }[] = [
  { label: "Unlimited AI drafts, replies and the agent", icon: Sparkles },
  { label: "Unlimited mail reading and sending", icon: MailCheck },
  { label: "Gmail + Outlook — both connected together", icon: Mails },
  { label: "Follow-ups, meetings and automations", icon: CalendarCheck },
  { label: "Cancel anytime", icon: CircleX },
];

function CornerMarks() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
      <span className="absolute -left-px -top-px size-2.5 border-l-2 border-t-2 border-white/25" />
      <span className="absolute -right-px -top-px size-2.5 border-r-2 border-t-2 border-white/25" />
      <span className="absolute -bottom-px -left-px size-2.5 border-b-2 border-l-2 border-white/25" />
      <span className="absolute -bottom-px -right-px size-2.5 border-b-2 border-r-2 border-white/25" />
    </div>
  );
}

export function PaywallCard({
  reason,
  className,
}: {
  reason: PaywallReason | null;
  className?: string;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const plan = usePaywallStore((state) => state.plan);
  const close = usePaywallStore((state) => state.close);
  const [interval, setInterval] = React.useState<"month" | "year">("year");

  const [busy, setBusy] = React.useState(false);
  const copy = REASON_COPY[reason ?? "ai"];
  const creditsReason = reason === "credits";
  const prices = (plan ?? BILLING_PLAN).prices;
  const price = interval === "year" ? prices.year.amountUsd : prices.month.amountUsd;

  const primaryAction = () => {
    setBusy(true);
    router.push(creditsReason ? "/checkout/credits" : `/checkout?interval=${interval}`);
  };

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: 10, scale: 0.99 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "relative w-full max-w-[440px] overflow-hidden border border-white/12",
        "bg-white/[0.04] backdrop-blur-2xl backdrop-saturate-150",
        "shadow-[0_30px_90px_-30px_rgba(0,0,0,0.9),inset_0_1px_0_0_rgba(255,255,255,0.08)]",
        className,
      )}
    >
      <CornerMarks />

      {/* Header band: the agent mark, the reason, and a hairline rule. */}
      <div className="relative flex items-center gap-3 border-b border-white/10 px-7 py-4 sm:px-8">
        <TartlyAgentLogo className="size-7 shrink-0" />
        <span className="text-[10.5px] font-medium uppercase tracking-[0.22em] text-white/60">
          {copy.eyebrow}
        </span>
      </div>

      <div className="relative px-7 py-6 sm:px-8 sm:py-7">
        <h2 className="text-[24px] font-semibold leading-[1.1] tracking-[-0.02em] text-white">
          {copy.title}
        </h2>
        <p className="mt-3 text-[13.5px] leading-relaxed text-white/65">
          {copy.body}
        </p>

        {creditsReason ? null : (
          <>
            {/* Billing cycle */}
            <div
              role="tablist"
              aria-label="Billing cycle"
              className="mt-7 inline-flex border border-white/15"
            >
              {(["year", "month"] as const).map((cycle, index) => {
                const active = interval === cycle;
                return (
                  <button
                    key={cycle}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setInterval(cycle)}
                    className={cn(
                      "inline-flex items-center gap-2 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60",
                      index === 1 && "border-l border-white/15",
                      active
                        ? "bg-white text-black"
                        : "text-white/55 hover:text-white",
                    )}
                  >
                    {cycle === "year" ? "Yearly" : "Monthly"}
                    {cycle === "year" && (
                      <span
                        className={cn(
                          "text-[10px] tracking-normal",
                          active ? "text-black/50" : "text-white/45",
                        )}
                      >
                        −20%
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-6 flex items-end gap-2">
              <span className="text-base font-medium leading-none text-white/50">
                $
              </span>
              <span className="text-5xl font-semibold leading-none tracking-[-0.03em] text-white tabular-nums">
                {price}
              </span>
              <span className="pb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">
                /mo
              </span>
            </div>
            <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-white/45">
              {interval === "year"
                ? `Billed yearly · $${prices.year.totalUsd}`
                : "Billed monthly"}
            </p>
          </>
        )}

        <div aria-hidden className="mt-6 h-px w-full bg-white/10" />

        <ul className="mt-6 flex list-none flex-col gap-2.5 p-0">
          {FEATURES.map(({ label, icon: Icon }) => (
            <li key={label} className="flex items-start gap-3">
              <Icon
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-white/45"
              />
              <span className="text-[12.5px] leading-5 text-white/75">
                {label}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-7 flex flex-col gap-2.5">
          <Button
            type="button"
            disabled={busy}
            onClick={primaryAction}
            className="h-11 w-full rounded-none bg-foreground text-[11px] font-semibold uppercase tracking-[0.2em] text-background hover:bg-foreground/80"
          >
            {busy
              ? "Opening checkout…"
              : creditsReason
                ? "Buy credits"
                : "Subscribe now"}
          </Button>
          <div className="flex items-center justify-between px-0.5">
            <button
              type="button"
              onClick={() => router.push("/pricing")}
              className="text-[11.5px] font-medium text-white/55 underline-offset-4 hover:text-white hover:underline"
            >
              Compare plans
            </button>
            <button
              type="button"
              onClick={close}
              className="text-[11.5px] font-medium text-white/40 hover:text-white/70"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
