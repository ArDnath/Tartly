import Link from "next/link";

import { Brand } from "@/components/marketing/brand";
import { cn } from "@/lib/utils";

const FOOTER_LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
];

export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cn("border-t border-border/60", className)}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <Brand />
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Lunabox is an AI email operator that triages your inbox, drafts
            replies, schedules meetings, and handles follow-ups.
          </p>
        </div>

        <div className="flex flex-col gap-4 text-sm md:items-end">
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-muted-foreground">
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {link.label}
              </Link>
            ))}
            <a
              href="mailto:support@lunabox.app"
              className="rounded-md transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Contact
            </a>
          </nav>
          <p className="text-muted-foreground">
            © {new Date().getFullYear()} Lunabox. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
