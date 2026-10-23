"use client";

import { ArrowLeft, Check, Coins, Loader2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { TartlyWordmark } from "@/components/shared/brand/tartly-wordmark";
import { Button } from "@/components/ui/button";
import { usePaywallStore } from "@/components/app/paywall/paywall-store";
import {
  CREDIT_PACKS,
  USD_PER_CREDIT,
  formatCredits,
} from "@/lib/billing/credit-config";
import { cn } from "@/lib/utils";

/**
 * One-time credit top-ups.
 *
 * Credits never expire and are spent by every AI action. The balance is shown
 * live (the same entitlement snapshot as the sidebar meter) and each pack starts
 * a Dodo-hosted one-time checkout; the credits land from the payment webhook.
 */
export function CreditPacksClient() {
  const entitlement = usePaywallStore((state) => state.entitlement);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const buy = async (packId: string) => {
    setBusyId(packId);
    setError(null);
    try {
      const response = await fetch("/api/billing/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { data?: { checkoutUrl?: string }; error?: { message?: string } }
        | null;
      if (!response.ok || !payload?.data?.checkoutUrl) {
        throw new Error(
          payload?.error?.message ?? "Could not start the purchase.",
        );
      }
      window.location.assign(payload.data.checkoutUrl);
    } catch (buyError) {
      setError(
        buyError instanceof Error
          ? buyError.message
          : "Could not start the purchase.",
      );
      setBusyId(null);
    }
  };

  const balance = entitlement?.credits.balance ?? 0;

  return (
    <div className="min-h-dvh bg-[#0F0F0F]">
      <header className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
        <TartlyWordmark className="text-[15px]" />
        <Link
          href="/mail"
          className="flex items-center gap-1.5 text-[12px] font-medium text-white/55 transition-colors hover:text-white"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Back to inbox
        </Link>
      </header>

      <main className="mx-auto max-w-4xl px-6 pb-24 pt-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-white/45">
          AI credits
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-white">
          Top up your AI operator
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/60">
          Every AI action — triage, drafts, the agent — spends credits. Top-ups
          never expire and stack on top of your monthly allowance.
        </p>

        <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3.5 py-2">
          <Coins className="size-4 text-foreground" aria-hidden />
          <span className="text-sm text-white/70">Current balance</span>
          <span className="text-sm font-semibold tabular-nums text-white">
            {formatCredits(balance)} credits
          </span>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {CREDIT_PACKS.map((pack) => {
            const busy = busyId === pack.id;
            const perDollar = pack.credits / pack.usd;
            return (
              <div
                key={pack.id}
                className={cn(
                  "relative flex flex-col rounded-2xl border bg-[#141416]/80 p-5 backdrop-blur-xl",
                  pack.badge
                    ? "border-foreground/40"
                    : "border-white/12",
                )}
              >
                {pack.badge ? (
                  <span className="absolute -top-2.5 left-5 rounded-full bg-foreground px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-background">
                    {pack.badge}
                  </span>
                ) : null}

                <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/45">
                  {pack.label}
                </span>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-3xl font-semibold tabular-nums text-white">
                    ${pack.usd}
                  </span>
                </div>
                <div className="mt-1 text-[13px] text-white/60">
                  {formatCredits(pack.credits)} credits
                </div>

                <ul className="mt-5 flex flex-col gap-2">
                  <li className="flex items-center gap-2 text-[12.5px] text-white/70">
                    <Check className="size-3.5 text-foreground" aria-hidden />
                    {formatCredits(perDollar)} credits per dollar
                  </li>
                  <li className="flex items-center gap-2 text-[12.5px] text-white/70">
                    <Check className="size-3.5 text-foreground" aria-hidden />
                    Never expires
                  </li>
                </ul>

                <Button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void buy(pack.id)}
                  className="mt-6 h-10 w-full rounded-[10px] bg-foreground text-[13px] font-semibold text-background hover:bg-foreground/80"
                >
                  {busy ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      Opening checkout…
                    </span>
                  ) : (
                    `Buy ${formatCredits(pack.credits)} credits`
                  )}
                </Button>
              </div>
            );
          })}
        </div>

        {error ? (
          <p className="mt-4 text-[12.5px] text-red-400">{error}</p>
        ) : null}

        <p className="mt-8 max-w-xl text-[11.5px] leading-relaxed text-white/40">
          Each credit is worth ${USD_PER_CREDIT.toFixed(2)} of AI usage.
          Purchases are processed securely by Dodo Payments; Tartly never sees
          your card.
        </p>
      </main>
    </div>
  );
}
