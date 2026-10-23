"use client";

import { GoogleIcon } from "@/components/icons/google-icon";
import { OutlookIcon } from "@/components/icons/outlook-icon";
import type { MailProvider } from "@/lib/mail/types";
import { cn } from "@/lib/utils";

/**
 * A quiet marker showing which connected account a shared-inbox row belongs to.
 * Rendered only when the list is a real merge (provider is known); the tooltip
 * carries the account address so a user can tell two Gmail/Outlook accounts apart
 * at a glance.
 */
export function MailAccountBadge({
  provider,
  accountEmail,
  className,
}: {
  provider?: MailProvider;
  accountEmail?: string;
  className?: string;
}) {
  if (!provider) return null;
  const label = provider === "outlook" ? "Outlook" : "Gmail";
  const Icon = provider === "outlook" ? OutlookIcon : GoogleIcon;

  return (
    <span
      title={accountEmail ? `${label} · ${accountEmail}` : label}
      aria-label={accountEmail ? `${label} account ${accountEmail}` : label}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center",
        className,
      )}
    >
      <Icon className="size-3.5" />
    </span>
  );
}
