import Link from "next/link";

import { Brand } from "@/components/marketing/brand";
import { MobileNav } from "@/components/marketing/landing/mobile-nav";
import { NAV_LINKS } from "@/components/marketing/landing/nav";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SiteHeader({ className }: { className?: string }) {
  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-border/60 bg-canvas/75 backdrop-blur-xl",
        className,
      )}
    >
      <div className="relative mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-6">
        <Link
          href="/"
          className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Brand />
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
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

        <div className="flex items-center gap-2">
          <Link
            href="/auth"
            className={cn(
              buttonVariants({ size: "lg" }),
              "hidden h-10 rounded-full px-5 sm:inline-flex",
            )}
          >
            Get started
          </Link>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
