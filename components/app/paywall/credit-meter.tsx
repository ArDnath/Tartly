"use client";

import { Coins } from "@phosphor-icons/react";
import Link from "next/link";

import { usePaywallStore } from "@/components/app/paywall/paywall-store";
import { formatCredits } from "@/lib/billing/credit-config";
import { cn } from "@/lib/utils";

/**
 * The AI credit meter for the mail agent panel.
 *
 * A slim, instrument-style strip pinned to the top of the agent transcript: the
 * remaining balance, a hairline allowance bar and a "Top up" affordance. The
 * balance is server-derived (carried on the entitlement snapshot the billing
 * provider polls); this component only mirrors it, exactly like the rest of the
 * paywall chrome.
 *
 * On the design system: the strip is flat and tonal — a single hairline rule, an
 * uppercase micro-label and tabular numerals. The allowance bar fills with Paper
 * White (`--foreground`), never the Operator Spectrum: credits are an operator
 * instrument, not machine-authored content, and the machine gradient is reserved
 * for AI-authored affordances. When the balance empties the strip flips to the
 * one warm signal the system allows (`--warning`) and offers the top-up.
 */
export function CreditMeterStrip({ className }: { className?: string }) {
  const entitlement = usePaywallStore((state) => state.entitlement);

  // Nothing to show until the first status load. Hide from free accounts with
  // no credits — the paywall is their upsell, not this strip.
  if (!entitlement) return null;
  if (!entitlement.isSubscriber && entitlement.credits.balance <= 0) return null;

  const { balance, lifetimeGranted } = entitlement.credits;
  const empty = balance <= 0;
  const pct =
    lifetimeGranted > 0
      ? Math.max(0, Math.min(100, (balance / lifetimeGranted) * 100))
      : empty
        ? 0
        : 100;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-3 border-b border-border px-3.5 py-2",
        empty && "bg-warning/[0.06]",
        className,
      )}
    >
      <Coins
        className={cn(
          "size-3.5 shrink-0",
          empty ? "text-warning" : "text-muted-foreground",
        )}
        aria-hidden
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            AI credits
          </span>
          <span className="truncate text-[12px] font-semibold tabular-nums text-foreground">
            {formatCredits(balance)}
            <span className="ml-1 text-[10px] font-normal uppercase tracking-[0.08em] text-muted-foreground">
              {empty ? "empty" : "credits"}
            </span>
          </span>
        </div>

        <div
          className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-border"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Credit balance"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500",
              empty ? "bg-warning" : "bg-foreground",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <Link
        href="/checkout/credits"
        className={cn(
          "shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
          empty
            ? "bg-warning text-warning-foreground hover:bg-warning/90"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {empty ? "Top up" : "Buy more"}
      </Link>
    </div>
  );
}
