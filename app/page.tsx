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
  title: "Redape — Your AI email operator",
  description:
    "Redape is an AI email operator that triages your inbox, drafts replies, schedules meetings, and handles follow-ups. Redape connects to your Gmail and Google Calendar only with the permissions you approve.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Redape — Your AI email operator",
    description:
      "Triage your inbox, draft replies, schedule meetings, and handle follow-ups with an AI email operator that works in your inbox.",
    siteName: "Redape",
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
      "Redape writes replies that sound like you. Nothing is sent on its own — drafts wait for your review and approval.",
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
      "Redape tracks threads that are waiting on a reply and nudges you — or drafts the nudge — so nothing quietly slips.",
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
      "You choose whether to grant Gmail and Google Calendar access. Skip it and the rest of Redape stays available.",
  },
  {
    title: "Review, approve, done",
    description:
      "Redape triages and drafts in the background. You stay in control of everything that leaves your inbox.",
  },
];

const PERMISSIONS: { title: string; description: string }[] = [
  {
    title: "Gmail — read and organise",
    description:
      "Used to read the messages you ask Redape to work on, and to label and triage them in your inbox.",
  },
  {
    title: "Gmail — send on your approval",
    description:
      "Used only to send replies and follow-ups that you have reviewed and approved. Redape never sends mail silently.",
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
    text: "You can disconnect Google at any time from your Google account settings, and Redape stops accessing it immediately.",
  },
  {
    icon: ShieldCheck,
    text: "Access is limited to the scopes you approve. We request nothing beyond what the features above need.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-canvas-foreground">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden px-5 py-20 sm:px-6 sm:py-28">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(circle_at_top,_color-mix(in_oklab,var(--canvas-foreground)_7%,transparent),_transparent_40%)] dark:opacity-40 dark:[background-image:radial-gradient(circle_at_top,_color-mix(in_oklab,var(--canvas-foreground)_9%,transparent),_transparent_40%)]"
          />

          <div className="relative mx-auto flex w-full max-w-3xl flex-col items-center text-center">
            <Brand size={64} wordmarkClassName="text-3xl" className="gap-3" />

            <span className="mt-8 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground">
              AI email operator
            </span>

            <h1 className="mt-6 text-balance text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">
              Your inbox, handled.
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              Redape is an AI email operator that triages your mail, drafts
              replies, schedules meetings, and chases follow-ups — so you can
              spend your time on work that matters.
            </p>

            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
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
        </section>

        {/* About the app */}
        <section
          id="about"
          className="scroll-mt-20 border-t border-border/60 px-5 py-20 sm:px-6"
        >
          <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
                About Redape
              </h2>
              <div className="mt-4 flex flex-col gap-4 text-base leading-relaxed text-muted-foreground">
                <p>
                  Redape is an AI email operator — a web application that works
                  inside your Gmail inbox. It sorts incoming mail by what needs
                  you now, drafts replies in your voice, finds meeting times in
                  your Google Calendar, and follows up on threads that are
                  waiting on someone.
                </p>
                <p>
                  Redape is built for people who live in their inbox — founders,
                  operators, and small teams who want the routine parts of email
                  handled without giving up control of what actually gets sent.
                  It is a web app: sign in with Google on any modern browser and
                  Redape is available wherever you are.
                </p>
                <p>
                  Nothing leaves your inbox without your approval. Redape drafts
                  and proposes; you review and send.
                </p>
              </div>
            </div>

            <dl className="grid h-fit gap-px overflow-hidden rounded-xl border border-border/60 bg-border/60 text-sm sm:grid-cols-2 lg:grid-cols-1">
              {[
                { term: "App name", detail: "Redape" },
                { term: "What it is", detail: "An AI email operator for Gmail and Google Calendar" },
                { term: "Platform", detail: "Web app" },
                { term: "Support", detail: "support@redape.app" },
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

        {/* Features */}
        <section
          id="features"
          className="scroll-mt-20 border-t border-border/60 px-5 py-20 sm:px-6"
        >
          <div className="mx-auto w-full max-w-6xl">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
                What Redape does
              </h2>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                Redape lives in your inbox alongside you. It handles the routine
                work of email and hands you decisions, not busywork.
              </p>
            </div>

            <ul className="mt-10 grid gap-4 sm:grid-cols-2">
              {FEATURES.map(({ icon: Icon, title, description }) => (
                <li
                  key={title}
                  className="rounded-xl border border-border/60 bg-card/50 p-6"
                >
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

        {/* How it works */}
        <section className="border-t border-border/60 px-5 py-20 sm:px-6">
          <div className="mx-auto w-full max-w-6xl">
            <h2 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
              How it works
            </h2>
            <ol className="mt-10 grid gap-6 sm:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title}>
                  <span className="flex size-8 items-center justify-center rounded-full border border-border bg-card text-sm font-semibold">
                    {index + 1}
                  </span>
                  <h3 className="mt-4 text-base font-semibold tracking-[-0.01em]">
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

        {/* Data & permissions */}
        <section
          id="data"
          className="scroll-mt-20 border-t border-border/60 px-5 py-20 sm:px-6"
        >
          <div className="mx-auto w-full max-w-6xl">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
                Your data and permissions
              </h2>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                Redape asks for Google access only when a feature needs it, and
                only for the permissions listed here. Signing in never grants
                inbox access — you approve that separately.
              </p>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {PERMISSIONS.map((permission) => (
                <div
                  key={permission.title}
                  className="rounded-xl border border-border/60 bg-card/50 p-6"
                >
                  <h3 className="text-sm font-semibold tracking-[-0.01em]">
                    {permission.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {permission.description}
                  </p>
                </div>
              ))}
            </div>

            <ul className="mt-8 flex flex-col gap-3">
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

            <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
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

        {/* CTA */}
        <section className="border-t border-border/60 px-5 py-20 sm:px-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
            <Brand size={40} wordmarkClassName="text-xl" />
            <h2 className="mt-6 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
              Get started with Redape
            </h2>
            <p className="mt-3 max-w-md text-base leading-relaxed text-muted-foreground">
              Connect your inbox and let Redape handle the email that&apos;s
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
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
