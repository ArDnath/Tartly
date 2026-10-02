import type { Metadata } from "next";
import {
  ArrowRight,
  BellRing,
  CalendarClock,
  Inbox,
  Link2,
  Lock,
  PenLine,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { Brand } from "@/components/marketing/brand";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Lunabox — Your AI email operator",
  description:
    "Lunabox is an AI email operator that triages your inbox, drafts replies, schedules meetings, and handles follow-ups. Lunabox connects to your Gmail and Google Calendar only with the permissions you approve.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Lunabox — Your AI email operator",
    description:
      "Triage your inbox, draft replies, schedule meetings, and handle follow-ups with an AI email operator that works in your inbox.",
    siteName: "Lunabox",
    type: "website",
  },
};

const FEATURES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: Inbox,
    title: "Inbox triage",
    description:
      "Every message is sorted by what needs you now and what can wait, so you start the day with the important mail already on top.",
  },
  {
    icon: PenLine,
    title: "Drafts in your voice",
    description:
      "Lunabox writes replies that sound like you. Nothing is sent on its own — drafts wait for your review and approval.",
  },
  {
    icon: CalendarClock,
    title: "Meeting scheduling",
    description:
      "It reads your availability and proposes times, then books the meeting on your calendar so the back-and-forth disappears.",
  },
  {
    icon: BellRing,
    title: "Follow-ups",
    description:
      "Lunabox tracks threads that are waiting on a reply and nudges you — or drafts the nudge — so nothing quietly slips.",
  },
];

const STEPS = [
  {
    title: "Sign in with Google",
    description:
      "Sign-in only uses your basic Google profile. Inbox access is a separate, explicit step you approve yourself.",
  },
  {
    title: "Connect your inbox and calendar",
    description:
      "You choose whether to grant Gmail and Google Calendar access. Skip it and the rest of Lunabox stays available.",
  },
  {
    title: "Review, approve, done",
    description:
      "Lunabox triages and drafts in the background. You stay in control of everything that leaves your inbox.",
  },
];

const PERMISSIONS: { title: string; description: string }[] = [
  {
    title: "Gmail — read and organise",
    description:
      "Used to read the messages you ask Lunabox to work on, and to label and triage them in your inbox.",
  },
  {
    title: "Gmail — send on your approval",
    description:
      "Used only to send replies and follow-ups that you have reviewed and approved. Lunabox never sends mail silently.",
  },
  {
    title: "Calendar — read availability",
    description:
      "Used to read your free/busy times so proposed meeting slots actually work for you.",
  },
  {
    title: "Calendar — add events",
    description:
      "Used to create and update the specific meetings you accept, so scheduling is completed in one place.",
  },
];

const DATA_PROMISES: { icon: LucideIcon; text: string }[] = [
  {
    icon: Lock,
    text: "We never sell your data, and we do not use your email or calendar content for advertising.",
  },
  {
    icon: Link2,
    text: "You can disconnect Google at any time from your Google account settings, and Lunabox stops accessing it immediately.",
  },
  {
    icon: ShieldCheck,
    text: "Access is limited to the scopes you approve. We request nothing beyond what the features above need.",
  },
];

/**
 * A decorative schematic of the triage surface. It uses the product's real
 * groupings and label tones but no invented addresses, subjects, or counts, so
 * it reads as a diagram of the workspace rather than a fabricated screenshot.
 * The wrapper is `aria-hidden`: nothing here is interactive.
 */
function TriageSchematic() {
  const rows = [
    { dot: "bg-mail-unread", tag: "Needs you", tagClass: "bg-mail-tag-important text-mail-tag-important-foreground" },
    { dot: "bg-mail-draft", tag: "Waiting", tagClass: "bg-mail-tag-calendar text-mail-tag-calendar-foreground" },
    { dot: "bg-foreground/25", tag: "Handled", tagClass: "bg-mail-chip text-mail-chip-foreground" },
  ];

  return (
    <div aria-hidden="true" className="relative">
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Inbox triage
          </span>
          <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-mail-unread motion-safe:animate-pulse" />
            Live
          </span>
        </div>

        <ul className="divide-y divide-border/60">
          {rows.map((row) => (
            <li key={row.tag} className="flex items-center gap-3 px-4 py-3.5">
              <span className={cn("size-2 shrink-0 rounded-full", row.dot)} />
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  row.tagClass,
                )}
              >
                {row.tag}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="h-1.5 w-3/4 rounded-full bg-foreground/12" />
                <span className="h-1.5 w-1/2 rounded-full bg-foreground/8" />
              </span>
              <span className="h-1.5 w-8 shrink-0 rounded-full bg-foreground/10" />
            </li>
          ))}
        </ul>

        <div className="border-t border-border/70 p-3">
          <div className="surface-ai-gradient rounded-[10px] p-px">
            <div className="rounded-[9px] bg-card p-3.5">
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                AI draft · in your voice
              </span>
              <div className="mt-3 flex flex-col gap-2">
                <span className="h-1.5 w-full rounded-full bg-foreground/12" />
                <span className="h-1.5 w-5/6 rounded-full bg-foreground/12" />
                <span className="h-1.5 w-2/3 rounded-full bg-foreground/8" />
              </div>
              <div className="mt-4 flex items-center gap-2">
                <span className="surface-ai-gradient inline-flex h-8 items-center rounded-md px-3 text-xs font-semibold text-white">
                  Approve &amp; Send
                </span>
                <span className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-muted-foreground">
                  Edit
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A row of beads echoing the dither motif; one warm signal bead, deliberately. */
function BeadRule() {
  return (
    <div aria-hidden="true" className="flex flex-wrap gap-1.5">
      {Array.from({ length: 28 }).map((_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: decorative, fixed length
          key={i}
          className={cn(
            "size-1.5 rounded-[1px]",
            i === 19 ? "bg-activity-accent" : "bg-foreground/15",
          )}
        />
      ))}
    </div>
  );
}

export default function LandingPage() {
  const [featured, ...rest] = FEATURES;

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-canvas-foreground">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-70 [background-image:radial-gradient(circle_at_top_left,_color-mix(in_oklab,var(--canvas-foreground)_8%,transparent),_transparent_45%)] dark:opacity-45"
          />

          <div className="relative mx-auto grid w-full max-w-6xl items-center gap-14 px-5 py-20 sm:px-6 sm:py-28 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-16">
            <div>
              <Brand size={52} wordmarkClassName="text-2xl" className="gap-3" />

              <h1 className="mt-8 max-w-xl text-balance text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">
                Your inbox, handled.
              </h1>

              <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
                Lunabox is an AI email operator that triages your mail, drafts
                replies, schedules meetings, and chases follow-ups — so you can
                spend your time on work that matters.
              </p>

              <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                <Link
                  href="/auth"
                  className={cn(
                    buttonVariants({ size: "lg" }),
                    "h-12 rounded-full px-7 text-base",
                  )}
                >
                  Get started
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/#features"
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "lg" }),
                    "h-12 rounded-full px-5 text-base",
                  )}
                >
                  See what it does
                </Link>
              </div>
            </div>

            <TriageSchematic />
          </div>
        </section>

        {/* About the app */}
        <section
          id="about"
          className="scroll-mt-20 border-t border-border/60 px-5 py-20 sm:px-6"
        >
          <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
                About Lunabox
              </h2>
              <div className="mt-5 flex flex-col gap-4 text-base leading-relaxed text-muted-foreground">
                <p>
                  Lunabox is an AI email operator — a web application that works
                  inside your Gmail inbox. It sorts incoming mail by what needs
                  you now, drafts replies in your voice, finds meeting times in
                  your Google Calendar, and follows up on threads that are
                  waiting on someone.
                </p>
                <p>
                  Lunabox is built for people who live in their inbox — founders,
                  operators, and small teams who want the routine parts of email
                  handled without giving up control of what actually gets sent.
                  It is a web app: sign in with Google on any modern browser and
                  Lunabox is available wherever you are.
                </p>
                <p>
                  Nothing leaves your inbox without your approval. Lunabox drafts
                  and proposes; you review and send.
                </p>
              </div>
            </div>

            <dl className="grid h-fit gap-px overflow-hidden rounded-xl border border-border/60 bg-border/60 text-sm sm:grid-cols-2 lg:grid-cols-1">
              {[
                { term: "App name", detail: "Lunabox" },
                { term: "What it is", detail: "An AI email operator for Gmail and Google Calendar" },
                { term: "Platform", detail: "Web app" },
                { term: "Support", detail: "support@lunabox.app" },
              ].map(({ term, detail }) => (
                <div key={term} className="bg-card/50 px-4 py-3">
                  <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {term}
                  </dt>
                  <dd className="mt-1 text-foreground">{detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Features — a flush, hairline board rather than a grid of floating cards. */}
        <section
          id="features"
          className="scroll-mt-20 border-t border-border/60 px-5 py-20 sm:px-6"
        >
          <div className="mx-auto w-full max-w-6xl">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
                What Lunabox does
              </h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                Lunabox lives in your inbox alongside you. It handles the routine
                work of email and hands you decisions, not busywork.
              </p>
            </div>

            <ul className="mt-10 grid gap-px overflow-hidden rounded-xl border border-border/60 bg-border/60 sm:grid-cols-2 lg:grid-cols-3">
              <li className="bg-canvas p-6 sm:col-span-2 sm:p-8 lg:col-span-3">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div className="max-w-xl">
                    <featured.icon
                      className="size-5 text-foreground"
                      aria-hidden="true"
                    />
                    <h3 className="mt-4 text-lg font-semibold tracking-[-0.02em]">
                      {featured.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {featured.description}
                    </p>
                  </div>
                  <BeadRule />
                </div>
              </li>

              {rest.map(({ icon: Icon, title, description }) => (
                <li key={title} className="bg-canvas p-6 sm:p-7">
                  <Icon className="size-5 text-foreground" aria-hidden="true" />
                  <h3 className="mt-4 text-base font-semibold tracking-[-0.01em]">
                    {title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works — a single hairline rail; the sequence carries meaning. */}
        <section className="border-t border-border/60 px-5 py-20 sm:px-6">
          <div className="mx-auto w-full max-w-6xl">
            <h2 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
              How it works
            </h2>
            <ol className="mt-10 grid gap-px overflow-hidden rounded-xl border border-border/60 bg-border/60 sm:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="bg-canvas p-6 sm:p-7">
                  <span className="text-[10px] font-medium tracking-[0.16em] text-muted-foreground tabular-nums">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-3 text-base font-semibold tracking-[-0.01em]">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {step.description}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Data & permissions — a ledger of scopes, then the promises. */}
        <section
          id="data"
          className="scroll-mt-20 border-t border-border/60 px-5 py-20 sm:px-6"
        >
          <div className="mx-auto w-full max-w-6xl">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
                Your data and permissions
              </h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                Lunabox asks for Google access only when a feature needs it, and
                only for the permissions listed here. Signing in never grants
                inbox access — you approve that separately.
              </p>
            </div>

            <dl className="mt-10 grid gap-px overflow-hidden rounded-xl border border-border/60 bg-border/60">
              {PERMISSIONS.map((permission) => (
                <div
                  key={permission.title}
                  className="grid gap-1 bg-canvas p-5 sm:grid-cols-[240px_1fr] sm:gap-8 sm:p-6"
                >
                  <dt className="text-sm font-semibold tracking-[-0.01em]">
                    {permission.title}
                  </dt>
                  <dd className="text-sm leading-relaxed text-muted-foreground">
                    {permission.description}
                  </dd>
                </div>
              ))}
            </dl>

            <ul className="mt-10 grid gap-6 sm:grid-cols-3">
              {DATA_PROMISES.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-3 text-sm">
                  <Icon
                    className="mt-0.5 size-4 shrink-0 text-foreground"
                    aria-hidden="true"
                  />
                  <span className="leading-relaxed text-muted-foreground">
                    {text}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-10 text-sm leading-relaxed text-muted-foreground">
              Read the full details in our{" "}
              <Link
                href="/privacy"
                className="font-medium text-foreground underline underline-offset-4"
              >
                Privacy Policy
              </Link>{" "}
              and{" "}
              <Link
                href="/terms"
                className="font-medium text-foreground underline underline-offset-4"
              >
                Terms of Service
              </Link>
              .
            </p>
          </div>
        </section>

        {/* CTA — one tonal panel with the bead texture, closing the page. */}
        <section className="border-t border-border/60 px-5 py-20 sm:px-6">
          <div className="mx-auto w-full max-w-6xl">
            <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/40 px-6 py-14 sm:px-12">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:radial-gradient(circle,_color-mix(in_oklab,var(--canvas-foreground)_34%,transparent)_1px,_transparent_1px)] [background-size:16px_16px]"
              />
              <div className="relative flex flex-col items-center text-center">
                <Brand size={40} wordmarkClassName="text-xl" />
                <h2 className="mt-6 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
                  Get started with Lunabox
                </h2>
                <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
                  Connect your inbox and let Lunabox handle the email that&apos;s
                  been handling you.
                </p>
                <Link
                  href="/auth"
                  className={cn(
                    buttonVariants({ size: "lg" }),
                    "mt-8 h-12 rounded-full px-7 text-base",
                  )}
                >
                  Get started
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
