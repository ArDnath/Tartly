"use client";

import {
  ArrowUpRight,
  Coins,
  CreditCard,
  History,
  Loader2,
  Receipt,
  RefreshCw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { usePaywallStore } from "@/components/app/paywall/paywall-store";
import { CREDIT_PACKS, formatCredits } from "@/lib/billing/credit-config";
import type {
  BillingLedgerEntry,
  BillingOverview,
} from "@/lib/billing/paywall-types";
import { cn } from "@/lib/utils";

/**
 * Billing & subscription tracking.
 *
 * Everything the operator's payer needs in one instrument panel: the current
 * plan and renewal state, the AI credit balance, one-time payments and the
 * credit ledger. All figures are derived from rows the billing runtime actually
 * wrote — nothing here is estimated.
 *
 * Design follows the app's tonal-first instrument language: flat surfaces one
 * step above the canvas, hairline rules, 10–13px type with tabular numerals and
 * a single uppercase micro-label per metric. No filled colour blocks, no
 * gradients, no purple — the only warm signal is the warning tone on an empty
 * credit balance or a past-due subscription.
 */
export function BillingSettings({ initial }: { initial: BillingOverview }) {
  const router = useRouter();
  const [overview, setOverview] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { entitlement, plan, subscription, payments, ledger } = overview;
  const prices = plan.prices;
  const yearly = entitlement.interval === "year";
  const isSubscriber = entitlement.isSubscriber;
  const { balance, lifetimeGranted, lifetimeSpent } = entitlement.credits;
  const creditsEmpty = balance <= 0;
  const creditsPct =
    lifetimeGranted > 0
      ? Math.max(0, Math.min(100, (balance / lifetimeGranted) * 100))
      : creditsEmpty
        ? 0
        : 100;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/billing/subscription", {
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { data: BillingOverview };
      setOverview(payload.data);
      // Keep the shared entitlement (credit strip, paywall) in lock-step.
      usePaywallStore.getState().applyEntitlement(payload.data.entitlement);
    } catch {
      // A failed refresh is non-fatal; the snapshot on screen stays.
    } finally {
      setRefreshing(false);
    }
  }, []);

  const openPortal = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { data?: { url?: string | null }; error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(
          payload?.error?.message ?? "Could not open the billing portal.",
        );
      }
      if (payload?.data?.url) {
        window.location.assign(payload.data.url);
        return;
      }
      // Simulation mode has no hosted portal: the call cancels directly and
      // reports back, so re-read the snapshot.
      await refresh();
      void usePaywallStore.getState().refresh();
    } catch (portalError) {
      setError(
        portalError instanceof Error
          ? portalError.message
          : "Could not open the billing portal.",
      );
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Your plan, AI credits and payment history.
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden />
          )}
          Refresh
        </Button>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}

      {/* Plan & renewal */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <CreditCard
              className="size-3.5 text-muted-foreground"
              aria-hidden
            />
            Plan
          </h3>
          <StatusChip
            status={subscription?.status ?? (isSubscriber ? "active" : "none")}
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-semibold tracking-tight text-foreground">
              {isSubscriber ? plan.name : "Free"}
            </span>
            <span className="text-[13px] tabular-nums text-muted-foreground">
              {isSubscriber
                ? `$${yearly ? prices.year.amountUsd : prices.month.amountUsd}/mo`
                : "$0"}
            </span>
          </div>

          {isSubscriber ? (
            <dl className="mt-3 flex flex-col gap-1.5 text-[12px]">
              <Row label="Billing">
                {yearly
                  ? `Yearly · $${prices.year.totalUsd}/yr`
                  : "Monthly · charged monthly"}
              </Row>
              <Row
                label={subscription?.cancelAtPeriodEnd ? "Access ends" : "Renews"}
              >
                {formatDate(subscription?.currentPeriodEnd ?? null)}
              </Row>
              {subscription?.startedAt ? (
                <Row label="Subscribed since">
                  {formatDate(subscription.startedAt)}
                </Row>
              ) : null}
            </dl>
          ) : (
            <p className="mt-2 max-w-prose text-[12.5px] leading-relaxed text-muted-foreground">
              Subscribe to unlock the AI operator, unlimited mail and a monthly
              AI credit allowance.
            </p>
          )}

          {isSubscriber && subscription?.cancelAtPeriodEnd ? (
            <p className="mt-3 border-l-2 border-warning/50 pl-2.5 text-[11.5px] leading-relaxed text-warning">
              Your subscription is set to cancel on{" "}
              {formatDate(subscription.currentPeriodEnd)}. You keep full access
              until then.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {isSubscriber ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void openPortal()}
                >
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : null}
                  {entitlement.billingConfigured
                    ? "Manage billing"
                    : "Cancel subscription"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push("/pricing")}
                >
                  Change plan
                  <ArrowUpRight className="size-3.5" aria-hidden />
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={() => router.push("/checkout?interval=year")}
              >
                Subscribe — ${prices.year.amountUsd}/mo, billed yearly
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* AI credits */}
      <section className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <Coins className="size-3.5 text-muted-foreground" aria-hidden />
          AI credits
        </h3>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[22px] font-semibold leading-none tabular-nums text-foreground">
              {formatCredits(balance)}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              credits
            </span>
          </div>

          <div
            className="mt-3 h-1 w-full overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-valuenow={Math.round(creditsPct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Credit balance"
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500",
                creditsEmpty ? "bg-warning" : "bg-foreground",
              )}
              style={{ width: `${creditsPct}%` }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
            <span>Granted {formatCredits(lifetimeGranted)}</span>
            <span>Used {formatCredits(lifetimeSpent)}</span>
          </div>

          {creditsEmpty && isSubscriber ? (
            <p className="mt-3 border-l-2 border-warning/50 pl-2.5 text-[11.5px] leading-relaxed text-warning">
              Your credits are used up. Top up to keep triage, drafts and the
              agent running — credits never expire.
            </p>
          ) : (
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
              Every AI action — triage, drafts, the agent — spends credits.
              Top-ups never expire.
            </p>
          )}

          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => router.push("/checkout/credits")}
          >
            {creditsEmpty ? "Top up credits" : "Buy more credits"}
          </Button>
        </div>
      </section>

      {/* One-time payments */}
      <section className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <Receipt className="size-3.5 text-muted-foreground" aria-hidden />
          Payments
        </h3>

        {payments.length === 0 ? (
          <p className="rounded-lg border border-border bg-card px-4 py-5 text-[12.5px] text-muted-foreground">
            No one-time purchases yet. Credit top-ups and their receipts will
            appear here.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-border bg-card">
            {payments.map((payment) => (
              <li
                key={payment.id}
                className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground">
                  <Receipt className="size-3.5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-foreground">
                    {formatCredits(payment.credits)} credits
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {formatDate(payment.createdAt)} · {packLabel(payment.packId)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[12.5px] font-medium tabular-nums text-foreground">
                    {formatUsd(payment.usdCents)}
                  </span>
                  <span className="block text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {payment.status}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Credit ledger */}
      <section className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <History className="size-3.5 text-muted-foreground" aria-hidden />
          Credit activity
        </h3>

        {ledger.length === 0 ? (
          <p className="rounded-lg border border-border bg-card px-4 py-5 text-[12.5px] text-muted-foreground">
            No credit activity yet. Allowances and AI usage will be listed here.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-border bg-card">
            {ledger.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-foreground">
                    {LEDGER_LABELS[entry.reason]}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {formatDate(entry.createdAt)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={cn(
                      "block text-[12.5px] font-medium tabular-nums",
                      entry.delta >= 0
                        ? "text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {formatSigned(entry.delta)}
                  </span>
                  <span className="block text-[10px] tabular-nums text-muted-foreground">
                    balance {formatCredits(entry.balanceAfter)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** A label/value line inside a card's definition list. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums text-foreground">{children}</dd>
    </div>
  );
}

/** The status chip, tone-on-tone with no filled colour block. */
function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide",
        statusTone(status),
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

const STATUS_LABELS: Record<string, string> = {
  none: "Free",
  pending: "Pending",
  active: "Active",
  trialing: "Trialing",
  past_due: "Past due",
  on_hold: "On hold",
  paused: "Paused",
  cancelled: "Cancelled",
  failed: "Failed",
  expired: "Expired",
};

function statusTone(status: string): string {
  switch (status) {
    case "active":
    case "trialing":
      return "border-transparent bg-foreground text-background";
    case "pending":
    case "past_due":
    case "on_hold":
    case "paused":
      return "border-warning/40 text-warning";
    case "failed":
      return "border-destructive/40 text-destructive";
    default:
      return "border-border text-muted-foreground";
  }
}

const LEDGER_LABELS: Record<BillingLedgerEntry["reason"], string> = {
  grant_plan: "Plan allowance",
  grant_purchase: "Credit purchase",
  usage: "AI usage",
  refund: "Refund",
  adjustment: "Adjustment",
};

const PACK_LABELS = new Map(CREDIT_PACKS.map((pack) => [pack.id, pack.label]));

function packLabel(packId: string): string {
  return PACK_LABELS.get(packId) ?? packId;
}

function formatSigned(delta: number): string {
  const sign = delta >= 0 ? "+" : "−";
  return `${sign}${formatCredits(Math.abs(delta))}`;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
