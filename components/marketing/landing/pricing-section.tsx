"use client";

import React from "react";
import {
  BadgeCheck,
  CircleX,
  ClipboardCheck,
  LifeBuoy,
  Mails,
  MessagesSquare,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { Reveal } from "@/components/shared/motion/reveal";
import { StaggeredText } from "@/components/shared/motion/staggered-text";
import { cn } from "@/lib/utils";

/*
 * Pricing plans. Professional is priced per user and gives a discount when
 * billed annually; Enterprise is quoted per organization. Feature copy is
 * intentionally drawn from capabilities already described on the landing page,
 * and each privilege carries its own icon so the value reads at a glance.
 */
type Feature = {
  label: string;
  icon: LucideIcon;
};

type Plan = {
  name: string;
  tagline: string;
  /** When true the card shows "Custom" instead of a monthly/yearly price. */
  customPricing: boolean;
  monthlyPrice?: number;
  yearlyPrice?: number;
  /** Small print shown under a custom price. */
  note?: string;
  cta: { label: string; href: string };
  features: Feature[];
};

const PLANS: Plan[] = [
  {
    name: "Professional",
    tagline: "Perfect for individuals who want their inbox handled.",
    customPricing: false,
    monthlyPrice: 25,
    yearlyPrice: 20,
    cta: { label: "Get started", href: "/auth" },
    features: [
      { label: "Full AI inbox — summaries, drafts, and replies", icon: Sparkles },
      { label: "Follow-ups and conversation tracking", icon: MessagesSquare },
      { label: "Campaigns and multi-step workflows", icon: Workflow },
      { label: "Approval controls and full activity history", icon: ClipboardCheck },
      { label: "Gmail + Google Calendar", icon: Mails },
      { label: "Cancel anytime", icon: CircleX },
    ],
  },
  {
    name: "Enterprise",
    tagline: "Custom tailored to your organization.",
    customPricing: true,
    note: "Volume pricing · security review · dedicated support",
    cta: { label: "Contact sales", href: "mailto:support@tartly.in" },
    features: [
      { label: "Everything in Professional", icon: BadgeCheck },
      { label: "Gmail + Google Calendar for every seat", icon: Mails },
      { label: "Custom workflows, limits, and retention", icon: SlidersHorizontal },
      { label: "SSO and security review", icon: ShieldCheck },
      { label: "Admin controls and seat management", icon: Users },
      { label: "Dedicated onboarding and support", icon: LifeBuoy },
    ],
  },
];

/**
 * Resolve a plan's call to action. The paid plan always points at the in-app
 * `/checkout` (which sends signed-out visitors through Google sign-in first, then
 * back to checkout); Enterprise keeps its contact link.
 */
function planCta(plan: Plan, isYearly: boolean): { label: string; href: string } {
  if (plan.customPricing) return plan.cta;
  return {
    label: plan.cta.label,
    href: `/checkout?interval=${isYearly ? "year" : "month"}`,
  };
}

/**
 * `geometric` is the squared treatment used by the landing page and the
 * `/pricing` route: two panels butt-jointed into one instrument, corner
 * registration marks, and hairline rules instead of rounded, shadowed cards.
 * `default` is the softer, tonal card table kept as an alternate treatment.
 */
export type PricingVariant = "default" | "geometric";

/** Billing cycle, shared by both treatments. Yearly leads so the discount shows. */
type Cycle = "Monthly" | "Yearly";

/**
 * Four L-shaped registration marks pinned to the frame's corners — the same
 * geometric tell the activity board uses, so the pricing table reads as a measured
 * instrument panel rather than a floating card. Purely decorative.
 */
function CornerMarks() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
      <span className="absolute -left-px -top-px size-2.5 border-l border-t border-white/40" />
      <span className="absolute -right-px -top-px size-2.5 border-r border-t border-white/40" />
      <span className="absolute -bottom-px -left-px size-2.5 border-b border-l border-white/40" />
      <span className="absolute -bottom-px -right-px size-2.5 border-b border-r border-white/40" />
    </div>
  );
}

/**
 * The price figure with the monthly/yearly swap. Tabular numerals keep the
 * line from shifting as the value changes.
 */
function AnimatedPrice({
  value,
  billing,
  reduceMotion,
}: {
  value: number | undefined;
  billing: Cycle;
  reduceMotion: boolean | null;
}) {
  const figure = (
    <span className="inline-block text-4xl font-semibold leading-none tabular-nums tracking-[-0.03em] text-white sm:text-5xl">
      {value}
    </span>
  );

  if (reduceMotion) return figure;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={billing}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="inline-block text-4xl font-semibold leading-none tabular-nums tracking-[-0.03em] text-white sm:text-5xl"
      >
        {value}
      </motion.span>
    </AnimatePresence>
  );
}

function BillingToggle({
  billing,
  onChange,
  variant,
}: {
  billing: Cycle;
  onChange: (cycle: Cycle) => void;
  variant: PricingVariant;
}) {
  if (variant === "default") {
    return (
      <div className="mt-10 flex justify-center">
        <div
          role="tablist"
          aria-label="Billing cycle"
          className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] p-1"
        >
          {(["Monthly", "Yearly"] as const).map((cycle) => {
            const active = billing === cycle;
            return (
              <button
                key={cycle}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onChange(cycle)}
                className={cn(
                  "relative inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-semibold leading-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/50",
                  active
                    ? "bg-[#8b5cf6] text-white shadow-[0_2px_12px_rgba(139,92,246,0.45)]"
                    : "text-white/60 hover:bg-white/5 hover:text-white",
                )}
              >
                <span>{cycle}</span>
                {cycle === "Yearly" && active && (
                  <span className="rounded-full bg-white/15 px-1.5 py-1 text-[11px] font-bold leading-none text-white">
                    Save 20%
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-10 flex justify-center">
      <div
        role="tablist"
        aria-label="Billing cycle"
        className="inline-flex border border-white/15"
      >
        {(["Monthly", "Yearly"] as const).map((cycle, index) => {
          const active = billing === cycle;
          return (
            <button
              key={cycle}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(cycle)}
              className={cn(
                "inline-flex items-center gap-2 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60",
                index === 1 && "border-l border-white/15",
                active ? "bg-white text-black" : "text-white/55 hover:text-white",
              )}
            >
              <span>{cycle}</span>
              {cycle === "Yearly" && (
                <span
                  className={cn(
                    "text-[10px] font-medium tracking-normal",
                    active ? "text-black/50" : "text-white/50",
                  )}
                >
                  −20%
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The privilege list shared by both treatments. Every point carries its own
 * line icon so value reads at a glance. The glyphs stay neutral (never
 * coloured) so they sit flush on the hairline grid rather than fighting it.
 */
function FeatureList({
  features,
  variant,
}: {
  features: Feature[];
  variant: PricingVariant;
}) {
  if (variant === "default") {
    return (
      <ul aria-label="Features" className="flex list-none flex-col gap-3 p-0">
        {features.map(({ label, icon: Icon }) => (
          <li key={label} className="flex items-start gap-2.5">
            <Icon
              aria-hidden
              className="mt-px size-[18px] shrink-0 text-white/45"
            />
            <span className="flex-1 text-sm font-medium leading-[1.35] tracking-[-0.01em] text-white">
              {label}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul
      aria-label="Features"
      className="mt-7 flex list-none flex-col gap-3.5 p-0"
    >
      {features.map(({ label, icon: Icon }) => (
        <li key={label} className="flex items-start gap-3">
          <Icon
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-white/45"
          />
          <span className="flex-1 text-[13px] font-medium leading-5 text-white/80">
            {label}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The softer tonal-card treatment, kept as an alternate to `geometric`. */
function DefaultPlans({
  billing,
  isYearly,
  reduceMotion,
}: {
  billing: Cycle;
  isYearly: boolean;
  reduceMotion: boolean | null;
}) {
  return (
    <div className="mt-8 grid gap-5 md:grid-cols-2">
      {PLANS.map((plan, i) => {
        const displayedPrice = isYearly ? plan.yearlyPrice : plan.monthlyPrice;
        const yearlyTotal = (plan.yearlyPrice ?? 0) * 12;
        const cta = planCta(plan, isYearly);

        return (
          <Reveal
            key={plan.name}
            delay={i * 0.08}
            className="mx-auto h-full w-full max-w-[380px]"
          >
            <div className="flex h-full flex-col gap-[18px] rounded-2xl border border-[#2E2E2E] bg-[#161616] p-6 shadow-[0_4px_24px_rgba(0,0,0,0.5)]">
              <header className="flex flex-col gap-1.5">
                <h3 className="text-xl font-semibold leading-[1.1] tracking-[-0.02em] text-white">
                  {plan.name}
                </h3>
                <p className="text-sm font-medium leading-[1.3] tracking-[-0.01em] text-white/70">
                  {plan.tagline}
                </p>
              </header>

              {plan.customPricing ? (
                <div className="flex flex-col gap-2">
                  <span className="text-5xl font-bold leading-none tracking-[-0.04em] text-white">
                    Custom
                  </span>
                  {plan.note && (
                    <span className="text-xs font-semibold leading-tight text-white/60">
                      {plan.note}
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-end gap-2" aria-label="Price">
                    <span className="min-w-max -translate-y-1.5 text-2xl font-bold leading-none text-white">
                      $
                    </span>
                    <div className="relative flex min-w-max items-baseline gap-2">
                      {reduceMotion ? (
                        <span className="inline-block min-w-max text-5xl font-bold leading-none tracking-[-0.04em] text-white">
                          {displayedPrice}
                        </span>
                      ) : (
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.span
                            key={billing}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.22, ease: "easeOut" }}
                            className="inline-block min-w-max text-5xl font-bold leading-none tracking-[-0.04em] text-white"
                          >
                            {displayedPrice}
                          </motion.span>
                        </AnimatePresence>
                      )}
                      <span className="min-w-max text-sm font-semibold leading-tight text-white/60">
                        /month
                      </span>
                    </div>
                  </div>
                  {isYearly && (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-semibold leading-tight text-white/60">
                        billed yearly
                      </span>
                      <span className="text-xs font-semibold leading-tight text-white/60">
                        billed ${yearlyTotal}/year
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="h-px w-full bg-white/10" />

              <FeatureList features={plan.features} variant="default" />

              <motion.a
                href={cta.href}
                aria-label={cta.label}
                target={cta.href.startsWith("http") ? "_blank" : undefined}
                rel={cta.href.startsWith("http") ? "noreferrer" : undefined}
                whileHover={reduceMotion ? undefined : { backgroundColor: "#9469F7" }}
                whileTap={reduceMotion ? undefined : { scale: 0.98 }}
                className="mt-auto flex h-11 w-full items-center justify-center rounded-[10px] bg-[#8b5cf6] text-[15px] font-bold tracking-[-0.01em] text-white no-underline outline-none transition-shadow hover:shadow-[0_6px_20px_rgba(139,92,246,0.45)] focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <span className="min-w-max">{cta.label}</span>
              </motion.a>
            </div>
          </Reveal>
        );
      })}
    </div>
  );
}

/**
 * The `/pricing` treatment. The two plans are butt-jointed into a single
 * hairline frame — no gap, no rounding, no soft shadow — so they read as one
 * rate card split by a rule. Each panel keeps the type small and the rules
 * crisp; the geometric line carries the hierarchy.
 */
function GeometricPlans({
  billing,
  isYearly,
  reduceMotion,
}: {
  billing: Cycle;
  isYearly: boolean;
  reduceMotion: boolean | null;
}) {
  return (
    <Reveal delay={0.08} className="mx-auto mt-12 w-full max-w-3xl">
      <div className="relative border border-white/15 bg-[#141414]">
        <CornerMarks />
        <div className="grid divide-y divide-white/10 md:grid-cols-2 md:divide-x md:divide-y-0">
          {PLANS.map((plan) => {
            const displayedPrice = isYearly ? plan.yearlyPrice : plan.monthlyPrice;
            const yearlyTotal = (plan.yearlyPrice ?? 0) * 12;
            const quoted = plan.customPricing;
            const cta = planCta(plan, isYearly);

            return (
              <div key={plan.name} className="relative flex flex-col p-7 sm:p-9">
                <div className="flex items-center gap-2.5">
                  <span aria-hidden className="size-1.5 shrink-0 bg-white/40" />
                  <h3 className="text-[11px] font-medium uppercase tracking-[0.22em] text-white/55">
                    {plan.name}
                  </h3>
                </div>

                <p className="mt-4 min-h-[2.85rem] text-sm leading-relaxed text-white/60">
                  {plan.tagline}
                </p>

                <div className="mt-8 flex items-baseline gap-2" aria-label="Price">
                  {quoted ? (
                    <span className="text-4xl font-semibold leading-none tracking-[-0.03em] text-white sm:text-5xl">
                      Custom
                    </span>
                  ) : (
                    <>
                      <span className="text-base font-medium leading-none text-white/60">$</span>
                      <AnimatedPrice
                        value={displayedPrice}
                        billing={billing}
                        reduceMotion={reduceMotion}
                      />
                      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/55">
                        /mo
                      </span>
                    </>
                  )}
                </div>

                <p className="mt-3 min-h-[2.25rem] text-[11px] font-medium uppercase leading-relaxed tracking-[0.12em] text-white/50">
                  {quoted
                    ? plan.note
                    : isYearly
                      ? `Billed yearly · $${yearlyTotal}`
                      : "Billed monthly"}
                </p>

                <div className="mt-7 h-px w-full bg-white/10" />

                <FeatureList features={plan.features} variant="geometric" />

                <div className="mt-auto pt-9">
                  <a
                    href={cta.href}
                    aria-label={cta.label}
                    target={cta.href.startsWith("http") ? "_blank" : undefined}
                    rel={cta.href.startsWith("http") ? "noreferrer" : undefined}
                    className={cn(
                      "inline-flex h-11 w-full items-center justify-center text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#141414]",
                      quoted
                        ? "border border-white/20 text-white hover:border-white/40 hover:bg-white/[0.06]"
                        : "bg-[#8b5cf6] text-white hover:bg-[#7c4ce0]",
                    )}
                  >
                    {cta.label}
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Reveal>
  );
}

/**
 * The pricing table shared by the landing page (`#pricing`) and the standalone
 * `/pricing` route. Callers control the wrapper spacing via `className` and the
 * card treatment via `variant`.
 */
export function PricingSection({
  id = "pricing",
  eyebrow = "Pricing",
  heading = "Simple pricing, built to scale",
  description = "Start on Professional and pay less when you commit annually, or talk to us about an Enterprise plan tailored to your organization.",
  className = "relative mx-auto mt-52 max-w-[1250px] px-6",
  variant = "default",
}: {
  id?: string;
  eyebrow?: string;
  heading?: string;
  description?: string;
  className?: string;
  variant?: PricingVariant;
}) {
  // Billing cycle for the pricing cards — mirrors the Framer "Pricing Table"
  // toggle. Defaults to yearly so the discounted price and badge lead.
  const [billing, setBilling] = React.useState<Cycle>("Yearly");
  const reduceMotion = useReducedMotion();
  const isYearly = billing === "Yearly";

  return (
    <section id={id} className={className}>
      <div className="flex flex-col items-center text-center">
        <StaggeredText
          as="p"
          text={eyebrow}
          segmentBy="words"
          direction="bottom"
          delay={45}
          className="text-lg font-light text-white/40 md:text-xl"
        />
        {/* Static heading: the section deliberately avoids the Variable
            Proximity cursor effect so the cards below never shift when the
            pointer passes over the title. */}
        <h2 className="mt-2 text-4xl font-semibold text-white md:text-6xl">{heading}</h2>
        <StaggeredText
          as="p"
          text={description}
          segmentBy="words"
          direction="bottom"
          delay={35}
          className="mt-4 max-w-2xl text-base font-light text-white/70"
        />
      </div>

      <BillingToggle billing={billing} onChange={setBilling} variant={variant} />

      {variant === "geometric" ? (
        <GeometricPlans billing={billing} isYearly={isYearly} reduceMotion={reduceMotion} />
      ) : (
        <DefaultPlans billing={billing} isYearly={isYearly} reduceMotion={reduceMotion} />
      )}
    </section>
  );
}
