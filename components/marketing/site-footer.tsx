import Link from "next/link";

import { Brand } from "@/components/marketing/brand";
import { cn } from "@/lib/utils";

const FOOTER_COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/#product", label: "What it does" },
      { href: "/#guardrails", label: "Guardrails" },
      { href: "/#faq", label: "FAQ" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/#data", label: "Your data" },
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms of Service" },
    ],
  },
];

export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cn("border-t border-border/60", className)}>
      <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="max-w-sm">
            <Brand />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Tartly is an AI email operator that triages your inbox, drafts
              replies in your voice, schedules meetings, and handles follow-ups —
              with nothing leaving your mailbox without your approval.
            </p>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                {column.title}
              </p>
              <nav className="mt-4 flex flex-col gap-3 text-sm">
                {column.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="w-fit rounded-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-border/60 pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} Tartly. All rights reserved.
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span>Gmail + Outlook + Google Calendar</span>
            <a
              href="mailto:support@tartly.app"
              className="rounded-md transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              support@tartly.app
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
