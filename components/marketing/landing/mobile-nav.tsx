"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { NAV_LINKS } from "@/components/marketing/landing/nav";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The only navigation JavaScript on the marketing page: a disclosure sheet for
 * small screens. Everything else in the header is server-rendered.
 */
export function MobileNav() {
  const [open, setOpen] = React.useState(false);
  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex size-9 items-center justify-center rounded-md border border-border bg-canvas/60 text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
        )}
      >
        {open ? <X className="size-4" /> : <Menu className="size-4" />}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            key="sheet"
            initial={reduceMotion ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-x-0 top-full border-b border-border/70 bg-canvas/95 backdrop-blur-xl"
          >
            <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-5 py-4 sm:px-6">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-2 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/auth"
                onClick={() => setOpen(false)}
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "mt-2 h-11 rounded-full px-5",
                )}
              >
                Get started
              </Link>
            </nav>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
