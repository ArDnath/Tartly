import Link from "next/link";

import { Brand } from "@/components/marketing/brand";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/#about", label: "About" },
  { href: "/#features", label: "Features" },
  { href: "/#data", label: "Your data" },
  { href: "/privacy", label: "Privacy" },
];

export function SiteHeader({ className }: { className?: string }) {
  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-border/60 bg-canvas/80 backdrop-blur-md",
        className,
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-6">
        <Link
          href="/"
          className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Brand />
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <Link
          href="/auth"
          className={cn(buttonVariants({ size: "lg" }), "rounded-full px-5")}
        >
          Get started
        </Link>
      </div>
    </header>
  );
}
