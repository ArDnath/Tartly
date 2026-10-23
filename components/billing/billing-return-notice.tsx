"use client";

import { CheckCircle2, Info, XCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { usePaywallStore } from "@/components/app/paywall/paywall-store";
import { cn } from "@/lib/utils";

/**
 * The post-checkout toast.
 *
 * Dodo returns the user straight to `/mail?billing=…`; this reads that flag and
 * confirms the outcome, then disappears. It also refreshes the entitlement so a
 * just-purchased subscription or credit pack shows in the meter immediately.
 */
export function BillingReturnNotice() {
  const params = useSearchParams();
  const flag = params.get("billing");
  const refresh = usePaywallStore((state) => state.refresh);
  const [visible, setVisible] = React.useState(Boolean(flag));

  React.useEffect(() => {
    if (!flag) return;
    void refresh();
    const timer = window.setTimeout(() => setVisible(false), 6000);
    return () => window.clearTimeout(timer);
  }, [flag, refresh]);

  if (!visible || !flag) return null;

  const config =
    flag === "success"
      ? {
          icon: CheckCircle2,
          tone: "text-emerald-500",
          title: "Payment successful",
          body: "Your account is updated. A receipt is on its way to your email.",
        }
      : flag === "cancelled"
        ? {
            icon: XCircle,
            tone: "text-red-400",
            title: "Checkout cancelled",
            body: "No charge was made. You can try again whenever you are ready.",
          }
        : {
            icon: Info,
            tone: "text-amber-500",
            title: "Finalizing your payment",
            body: "This can take a few seconds. Your access updates automatically.",
          };
  const Icon = config.icon;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[140] flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border bg-background/95 p-3.5 shadow-lg backdrop-blur">
        <Icon className={cn("mt-0.5 size-5 shrink-0", config.tone)} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-foreground">
            {config.title}
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            {config.body}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
