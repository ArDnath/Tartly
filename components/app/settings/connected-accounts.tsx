"use client";

import * as React from "react";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { GoogleIcon } from "@/components/icons/google-icon";
import { OutlookIcon } from "@/components/icons/outlook-icon";
import { openPaywall, usePaywallStore } from "@/components/app/paywall/paywall-store";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import {
  GOOGLE_CONNECT_ADDITIONAL_PARAMS,
  GOOGLE_CONNECT_SCOPES,
  SETTINGS_CONNECT_CALLBACK_PATH,
  SETTINGS_CONNECT_ERROR_CALLBACK_PATH,
} from "@/lib/onboarding/constants";
import { MICROSOFT_MAIL_SCOPES } from "@/lib/outlook/scopes";
import type { MailAccount, MailProvider } from "@/lib/mail/types";
import { cn } from "@/lib/utils";

/**
 * The "connect accounts" panel. Gmail and Outlook are shown side by side so a
 * user can connect (or reconnect) either — or both — from one place. Connecting
 * runs a top-level OAuth navigation and lands back on this settings route, so
 * the server component re-reads the fresh account state and this panel redraws.
 */

const PROVIDER_META: Record<
  MailProvider,
  { label: string; detail: string; icon: React.ComponentType<{ className?: string }> }
> = {
  gmail: {
    label: "Gmail",
    detail: "Gmail & Google Calendar",
    icon: GoogleIcon,
  },
  outlook: {
    label: "Outlook",
    detail: "Outlook Mail & Calendar",
    icon: OutlookIcon,
  },
};

function StatusPill({ account }: { account: MailAccount }) {
  if (!account.connected) {
    return (
      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Not connected
      </span>
    );
  }
  if (!account.mailboxAccess) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
        <CircleAlert className="size-3" aria-hidden />
        Inbox access needed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
      <Check className="size-3" aria-hidden />
      Connected
    </span>
  );
}

function AccountRow({
  account,
  gatedByOtherAccount,
  onRefresh,
}: {
  account: MailAccount;
  /**
   * True when connecting this account would take the user from one mailbox to
   * two. A second inbox is a Professional feature, so a free user is walled
   * before the OAuth consent screen rather than after.
   */
  gatedByOtherAccount: boolean;
  onRefresh: () => void;
}) {
  const { data: session } = authClient.useSession();
  const isSubscriber = usePaywallStore(
    (state) => state.entitlement?.isSubscriber ?? false,
  );
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const meta = PROVIDER_META[account.provider];
  const Icon = meta.icon;

  const isMicrosoft = account.providerId === "microsoft";

  const start = async (run: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await run();
    } catch {
      setError(`Couldn't open the ${meta.label} consent screen. Please try again.`);
      setPending(false);
    }
  };

  const handleConnect = () => {
    // Intercept a second mailbox before the provider consent screen: a free
    // account should see the wall, not connect and then wonder why mail is
    // capped. Reconnecting an already-connected account is never gated.
    if (gatedByOtherAccount && !isSubscriber) {
      openPaywall("accounts");
      return;
    }
    return start(async () => {
      const result = isMicrosoft
        ? await authClient.linkSocial({
            provider: "microsoft",
            scopes: [...MICROSOFT_MAIL_SCOPES],
            callbackURL: SETTINGS_CONNECT_CALLBACK_PATH,
            errorCallbackURL: SETTINGS_CONNECT_ERROR_CALLBACK_PATH,
            disableRedirect: true,
          })
        : await authClient.linkSocial({
            provider: "google",
            scopes: [...GOOGLE_CONNECT_SCOPES],
            callbackURL: SETTINGS_CONNECT_CALLBACK_PATH,
            errorCallbackURL: SETTINGS_CONNECT_ERROR_CALLBACK_PATH,
            disableRedirect: true,
            ...(session?.user?.email ? { loginHint: session.user.email } : {}),
            additionalParams: { ...GOOGLE_CONNECT_ADDITIONAL_PARAMS },
          });

      if (result.data?.url) {
        window.location.replace(result.data.url);
        return;
      }
      setError(`Couldn't start the ${meta.label} connection.`);
      setPending(false);
    });
  };

  const handleDisconnect = async () => {
    setPending(true);
    setError(null);
    try {
      // Unlink by the Better Auth account row id (resolved from the provider).
      const { data: linked } = await authClient.listAccounts();
      const target = linked?.find(
        (entry) => entry.providerId === account.providerId,
      );
      if (!target) {
        onRefresh();
        return;
      }
      const result = await authClient.unlinkAccount({ accountId: target.id });
      if (result.error) {
        setError(result.error.message ?? "Couldn't disconnect that account.");
        setPending(false);
        return;
      }
      onRefresh();
    } catch {
      setError("Couldn't disconnect that account.");
      setPending(false);
    }
  };

  const actionLabel = !account.connected
    ? `Connect ${meta.label}`
    : account.mailboxAccess
      ? "Reconnect"
      : "Reconnect for inbox access";

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4",
        !account.available && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03]">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-foreground">
              {meta.label}
            </span>
            <StatusPill account={account} />
          </div>
          <p className="truncate text-[12px] text-muted-foreground">
            {account.email ?? meta.detail}
          </p>
        </div>
      </div>

      {!account.available ? (
        <p className="text-[12px] text-muted-foreground">
          Outlook isn&apos;t configured on this deployment yet.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={account.connected ? "outline" : "default"}
            onClick={handleConnect}
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {actionLabel}
          </Button>
          {account.connected ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleDisconnect}
              disabled={pending}
            >
              Disconnect
            </Button>
          ) : null}
        </div>
      )}

      {error ? (
        <p role="alert" className="text-[12px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ConnectedAccounts({ accounts }: { accounts: MailAccount[] }) {
  const router = useRouter();
  const connectedCount = accounts.filter(
    (account) => account.connected && account.mailboxAccess,
  ).length;

  const refresh = () => router.refresh();

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[13px] text-muted-foreground">
        {connectedCount > 1
          ? "Your Gmail and Outlook inboxes are merged into one shared All Mail view."
          : "Connect both Gmail and Outlook to see every inbox together in All Mail."}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {accounts.map((account) => (
          <AccountRow
            key={account.providerId}
            account={account}
            // Exactly one mailbox is live and this row would add a second.
            gatedByOtherAccount={
              connectedCount === 1 &&
              !(account.connected && account.mailboxAccess)
            }
            onRefresh={refresh}
          />
        ))}
      </div>

      <p className="text-[12px] text-muted-foreground">
        Tartly asks for read, send, and calendar access. You can reconnect any
        time to re-grant permissions.
      </p>
    </div>
  );
}
