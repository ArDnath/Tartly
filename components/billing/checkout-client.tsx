"use client";

import {
  CalendarCheck,
  Gift,
  Loader2,
  Lock,
  MailCheck,
  Mails,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { TartlyWordmark } from "@/components/shared/brand/tartly-wordmark";
import { Button } from "@/components/ui/button";
import { usePaywallStore } from "@/components/app/paywall/paywall-store";
import { BILLING_PLAN } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

type CheckoutSession = {
  mode: "live" | "sim";
  sessionId: string;
  /** Dodo-hosted checkout URL; only present in live mode. */
  checkoutUrl: string | null;
  /** Signed token for the in-app simulated checkout; only in sim mode. */
  simToken: string | null;
};

type CheckoutState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "redirecting" }
  | { status: "error"; message: string }
  | { status: "sim"; token: string };

/**
 * In-app checkout entry point. Payments are collected on Dodo's hosted,
 * PCI-compliant checkout page: the button asks our server to create a Checkout
 * Session and then redirects the browser to the returned URL, so the API key and
 * card data never touch our origin. When Dodo is unwired the same panel renders a
 * clearly-labelled simulation form so the flow is still complete and testable.
 */
export function CheckoutClient({ interval }: { interval: "month" | "year" }) {
  const [selected, setSelected] = React.useState<"month" | "year">(interval);
  const [state, setState] = React.useState<CheckoutState>({
    status: "idle",
  });

  const startCheckout = React.useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval: selected }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { data?: CheckoutSession; error?: { message?: string } }
        | null;
      if (!response.ok || !payload?.data) {
        throw new Error(payload?.error?.message ?? "Could not start checkout.");
      }

      const session = payload.data;
      if (session.mode === "live") {
        if (!session.checkoutUrl) {
          throw new Error("Checkout is unavailable right now.");
        }
        // Hosted checkout: hand off the browser to Dodo's secure page. The API
        // key stays server-side; we only receive a single-use session URL.
        setState({ status: "redirecting" });
        window.location.assign(session.checkoutUrl);
        return;
      }

      if (session.simToken) {
        setState({ status: "sim", token: session.simToken });
        return;
      }

      throw new Error("Checkout is unavailable right now.");
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Could not start checkout.",
      });
    }
  }, [selected]);

  return (
    <div className="min-h-dvh bg-[#0F0F0F]">
      <header className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <TartlyWordmark className="text-[15px]" />
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-white/45">
          <Lock className="size-3" aria-hidden />
          Secure checkout
        </span>
      </header>

      <main className="mx-auto grid max-w-5xl gap-8 px-6 pb-20 pt-6 md:grid-cols-[minmax(0,1fr)_420px]">
        <OrderSummary interval={selected} onIntervalChange={setSelected} />
        <section className="overflow-hidden rounded-2xl border border-white/12 bg-[#141416]/80 p-1 backdrop-blur-xl">
          {state.status === "sim" ? (
            <SimulatedCheckout token={state.token} interval={selected} />
          ) : (
            <CheckoutPanel
              interval={selected}
              state={state}
              onStart={startCheckout}
            />
          )}
        </section>
      </main>
    </div>
  );
}

const ORDER_FEATURES: { label: string; icon: LucideIcon }[] = [
  { label: "Unlimited AI drafting, triage and the agent", icon: Sparkles },
  { label: "Unlimited mail reading and sending", icon: MailCheck },
  { label: "Gmail + Google Calendar", icon: Mails },
  { label: "Follow-ups, meetings and automations", icon: CalendarCheck },
  { label: "Two months free on yearly billing", icon: Gift },
];

function OrderSummary({
  interval,
  onIntervalChange,
}: {
  interval: "month" | "year";
  onIntervalChange: (interval: "month" | "year") => void;
}) {
  const price = BILLING_PLAN.prices;
  const yearly = interval === "year";
  return (
    <aside className="flex flex-col gap-6 pt-2">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-white/45">
          {BILLING_PLAN.name}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-white">
          Subscribe to Tartly
        </h1>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-white/60">
          {BILLING_PLAN.tagline} Cancel anytime; your access continues to the
          end of the period.
        </p>
      </div>

      {/* Billing cycle: choose monthly or yearly right here. */}
      <div
        role="tablist"
        aria-label="Billing cycle"
        className="inline-flex w-fit border border-white/15"
      >
        {(["year", "month"] as const).map((cycle, index) => {
          const active = interval === cycle;
          return (
            <button
              key={cycle}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onIntervalChange(cycle)}
              className={cn(
                "inline-flex items-center gap-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60",
                index === 1 && "border-l border-white/15",
                active ? "bg-white text-black" : "text-white/55 hover:text-white",
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
                  Save 20%
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-white/12 bg-white/[0.03] p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-white/70">Tartly Professional</span>
          <span className="text-sm font-semibold text-white tabular-nums">
            ${yearly ? price.year.amountUsd : price.month.amountUsd}/mo
          </span>
        </div>
        <div className="mt-3 h-px w-full bg-white/10" />
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-[12px] text-white/50">Billing</span>
          <span className="text-[12px] text-white/70">
            {yearly
              ? `Yearly · $${price.year.totalUsd} charged today`
              : "Monthly · charged today"}
          </span>
        </div>
      </div>

      <ul className="flex flex-col gap-2.5">
        {ORDER_FEATURES.map(({ label, icon: Icon }) => (
          <li key={label} className="flex items-start gap-2.5">
            <Icon
              className="mt-0.5 size-3.5 shrink-0 text-white/45"
              aria-hidden
            />
            <span className="text-[12.5px] leading-5 text-white/70">
              {label}
            </span>
          </li>
        ))}
      </ul>

      <p className="flex items-center gap-2 text-[11px] text-white/40">
        <ShieldCheck className="size-3.5" aria-hidden />
        Payments are processed securely by Dodo Payments. Tartly never sees your
        card.
      </p>
    </aside>
  );
}

function CheckoutPanel({
  interval,
  state,
  onStart,
}: {
  interval: "month" | "year";
  state: CheckoutState;
  onStart: () => void;
}) {
  const busy = state.status === "loading" || state.status === "redirecting";

  return (
    <div className="flex min-h-[420px] flex-col justify-between p-6">
      <div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/60">
          <Lock className="size-3" aria-hidden />
          Secure checkout
        </span>
        <h2 className="mt-4 text-lg font-semibold text-white">
          Continue to secure checkout
        </h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-white/55">
          You&apos;ll complete your subscription on Dodo Payments&apos; hosted
          checkout — a PCI-compliant, Merchant-of-Record page — then come right
          back to Tartly. Your card details are entered there and never touch
          our servers.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-2.5">
        {state.status === "error" ? (
          <p className="text-[12px] text-red-400">{state.message}</p>
        ) : null}
        <Button
          type="button"
          disabled={busy}
          onClick={onStart}
          className="h-11 w-full rounded-[10px] bg-foreground text-[14px] font-semibold text-background hover:bg-foreground/80"
        >
          {busy ? (
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {state.status === "redirecting"
                ? "Redirecting to Dodo…"
                : "Preparing checkout…"}
            </span>
          ) : (
            `Subscribe — ${
              interval === "year"
                ? `$${BILLING_PLAN.prices.year.totalUsd}/yr`
                : `$${BILLING_PLAN.prices.month.amountUsd}/mo`
            }`
          )}
        </Button>
        <p className="text-center text-[11px] text-white/40">
          By subscribing you agree to Tartly&apos;s terms.
        </p>
      </div>
    </div>
  );
}

/**
 * Simulation-mode checkout: a real form and a real server call that activates
 * the subscription, without touching Dodo. It exists so the paywall can be
 * exercised end to end before Dodo keys are configured.
 */
function SimulatedCheckout({
  token,
  interval,
}: {
  token: string;
  interval: "month" | "year";
}) {
  const router = useRouter();
  const refresh = usePaywallStore((state) => state.refresh);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const complete = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error("Activation failed.");
      await refresh();
      router.replace("/mail?billing=success");
    } catch (activateError) {
      setError(
        activateError instanceof Error
          ? activateError.message
          : "Activation failed.",
      );
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[420px] flex-col justify-between p-6">
      <div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-amber-300">
          Simulation mode
        </span>
        <h2 className="mt-4 text-lg font-semibold text-white">
          Confirm your subscription
        </h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-white/55">
          Dodo Payments keys are not configured, so this activates a test
          subscription immediately. Add{" "}
          <code className="rounded bg-white/10 px-1 py-0.5 text-[11px]">
            DODO_PAYMENTS_API_KEY
          </code>{" "}
          and the product ids to use real payments.
        </p>

        <div className="mt-6 flex flex-col gap-3 opacity-70">
          <MockField label="Card number" value="4242 4242 4242 4242" />
          <div className="grid grid-cols-2 gap-3">
            <MockField label="Expiry" value="12 / 34" />
            <MockField label="CVC" value="123" />
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-2.5">
        {error ? <p className="text-[12px] text-red-400">{error}</p> : null}
        <Button
          type="button"
          disabled={busy}
          onClick={complete}
          className="h-11 w-full rounded-[10px] bg-foreground text-[14px] font-semibold text-background hover:bg-foreground/80"
        >
          {busy
            ? "Activating…"
            : `Subscribe — ${
                interval === "year"
                  ? `$${BILLING_PLAN.prices.year.totalUsd}/yr`
                  : `$${BILLING_PLAN.prices.month.amountUsd}/mo`
              }`}
        </Button>
      </div>
    </div>
  );
}

function MockField({ label, value }: { label: string; value: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5")}>
      <span className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-white/45">
        {label}
      </span>
      <span className="rounded-lg border border-white/12 bg-white/[0.04] px-3 py-2.5 font-mono text-[13px] text-white/70">
        {value}
      </span>
    </label>
  );
}
