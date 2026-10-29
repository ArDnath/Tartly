"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { GoogleIcon } from "@/components/icons/google-icon";
import { OutlookIcon } from "@/components/icons/outlook-icon";
import { useOnboarding } from "@/components/app/onboarding/onboarding-provider";
import { OnboardingStepAnimatedItem } from "@/components/app/onboarding/onboarding-step-animated-item";
import {
  OnboardingContentBlock,
  OnboardingStepHeading,
  OnboardingStepPage,
  OnboardingStepSubtitle,
  OnboardingStepTitle,
} from "@/components/app/onboarding/onboarding-step-layout";
import { authClient } from "@/lib/auth-client";
import {
  GOOGLE_CONNECT_ADDITIONAL_PARAMS,
  GOOGLE_CONNECT_CALLBACK_PATH,
  GOOGLE_CONNECT_ERROR_CALLBACK_PATH,
  GOOGLE_CONNECT_SCOPES,
  MICROSOFT_CONNECT_CALLBACK_PATH,
  MICROSOFT_CONNECT_ERROR_CALLBACK_PATH,
} from "@/lib/onboarding/constants";
import { MICROSOFT_MAIL_SCOPES } from "@/lib/outlook/scopes";

export const SyncEmailStep = () => {
  const { isNavigating, syncEmailError, syncEmailErrorDetail, user } =
    useOnboarding();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnectingOutlook, setIsConnectingOutlook] = useState(false);
  const [connectError, setConnectError] = useState(false);

  const outlookEnabled =
    process.env.NEXT_PUBLIC_MICROSOFT_CONNECT_ENABLED === "true";

  const showError = connectError || syncEmailError;

  const handleConnectGoogle = async () => {
    setIsConnecting(true);
    setConnectError(false);

    try {
      const result = await authClient.linkSocial({
        provider: "google",
        scopes: [...GOOGLE_CONNECT_SCOPES],
        callbackURL: GOOGLE_CONNECT_CALLBACK_PATH,
        errorCallbackURL: GOOGLE_CONNECT_ERROR_CALLBACK_PATH,
        // The flow is a top-level navigation, not a popup; keep it out of the
        // browser history so the onboarding back button never returns into an
        // in-progress Google consent screen.
        disableRedirect: true,
        // Pin the Google account to the one the user signed in with. Without
        // this, dropping `select_account` lets Google silently pick whichever
        // account is active in the browser — which may not be the linked one,
        // and the link callback then rejects it as EMAIL_DOES_NOT_MATCH.
        loginHint: user.email,
        additionalParams: { ...GOOGLE_CONNECT_ADDITIONAL_PARAMS },
      });

      if (result.data?.url) {
        window.location.replace(result.data.url);
        return;
      }

      console.error("[onboarding] Google connect did not return a URL", result.error);
      setConnectError(true);
    } catch (error) {
      console.error("[onboarding] Google connect failed", error);
      setConnectError(true);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleConnectOutlook = async () => {
    setIsConnectingOutlook(true);
    setConnectError(false);

    try {
      const result = await authClient.linkSocial({
        provider: "microsoft",
        scopes: [...MICROSOFT_MAIL_SCOPES],
        callbackURL: MICROSOFT_CONNECT_CALLBACK_PATH,
        errorCallbackURL: MICROSOFT_CONNECT_ERROR_CALLBACK_PATH,
        disableRedirect: true,
      });

      if (result.data?.url) {
        window.location.replace(result.data.url);
        return;
      }

      console.error("[onboarding] Outlook connect did not return a URL", result.error);
      setConnectError(true);
    } catch (error) {
      console.error("[onboarding] Outlook connect failed", error);
      setConnectError(true);
    } finally {
      setIsConnectingOutlook(false);
    }
  };

  return (
    <OnboardingStepPage>
      <OnboardingStepHeading>
        <OnboardingStepAnimatedItem index={0}>
          <OnboardingStepTitle>Sync your inbox</OnboardingStepTitle>
        </OnboardingStepAnimatedItem>
        <OnboardingStepAnimatedItem index={1}>
          <OnboardingStepSubtitle>
            Connect email and calendar so your assistant can read, draft, and
            schedule.
          </OnboardingStepSubtitle>
        </OnboardingStepAnimatedItem>
      </OnboardingStepHeading>

      <OnboardingStepAnimatedItem index={2}>
        <OnboardingContentBlock className="gap-3">
          {/*
            In-product privacy notice required by Google OAuth verification.
            It is shown before the consent screen and mirrors the disclosures
            in `/privacy`, so a reviewer sees the same scope story in the app.
          */}
          <div
            role="note"
            aria-label="What Tartly will access"
            className="rounded-2xl border border-border bg-muted/30 p-4 text-left"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              What Tartly will access
            </p>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              <li>
                <strong className="font-medium text-foreground">Gmail</strong> —
                read messages and threads, search, apply labels, archive, move
                to trash, and create drafts. Tartly sends only mail you approve,
                or mail that passes the Autopilot rules you opt into.
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  Google Calendar
                </strong>{" "}
                — read events and free/busy times, and create, change, or cancel
                events when you approve a scheduling action.
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  Permanent delete
                </strong>{" "}
                — permanently delete messages or empty trash only when you
                choose &ldquo;Delete forever&rdquo; or &ldquo;Empty trash&rdquo;.
              </li>
            </ul>
            <p className="mt-3 border-t border-border/70 pt-3 text-[11px] leading-relaxed text-muted-foreground">
              We do not sell Google user data, use it for advertising, or use
              Google Workspace APIs to develop, improve, or train
              non-personalized AI or ML models. Read the{" "}
              <Link
                href="/privacy#google-user-data"
                className="font-medium text-foreground underline underline-offset-2"
              >
                Privacy Policy
              </Link>{" "}
              and the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground underline underline-offset-2"
              >
                Google API Services User Data Policy
              </a>
              . You can revoke access at any time in your Google Account
              permissions or in Tartly under Settings → Connected accounts.
            </p>
          </div>

          <button
            type="button"
            onClick={handleConnectGoogle}
            disabled={isConnecting || isNavigating}
            aria-busy={isConnecting}
            aria-label={
              isConnecting ? "Connecting to Google…" : "Continue with Google"
            }
            title="Continue with Google"
            className="group flex w-full items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 text-left text-foreground transition-colors hover:border-foreground hover:bg-foreground hover:text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-60"
          >
            <span className="flex size-8 shrink-0 items-center justify-center">
              {isConnecting ? (
                <Loader2 className="size-6 animate-spin" />
              ) : (
                <GoogleIcon className="size-6" />
              )}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">
                {isConnecting ? "Connecting to Google…" : "Continue with Google"}
              </span>
              <span className="text-xs text-muted-foreground transition-colors group-hover:text-neutral-500">
                Gmail &amp; Google Calendar
              </span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-neutral-500" />
          </button>

          {/* Outlook connects to the same shared inbox when Entra ID
              credentials are configured; otherwise it is rendered as a
              disabled control so it can't advance the flow. */}
          {outlookEnabled ? (
            <button
              type="button"
              onClick={handleConnectOutlook}
              disabled={isConnectingOutlook || isNavigating}
              aria-busy={isConnectingOutlook}
              aria-label={
                isConnectingOutlook
                  ? "Connecting to Outlook…"
                  : "Continue with Outlook"
              }
              title="Continue with Outlook"
              className="group flex w-full items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 text-left text-foreground transition-colors hover:border-foreground hover:bg-foreground hover:text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-60"
            >
              <span className="flex size-8 shrink-0 items-center justify-center">
                {isConnectingOutlook ? (
                  <Loader2 className="size-6 animate-spin" />
                ) : (
                  <OutlookIcon className="size-6" />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">
                  {isConnectingOutlook
                    ? "Connecting to Outlook…"
                    : "Continue with Outlook"}
                </span>
                <span className="text-xs text-muted-foreground transition-colors group-hover:text-neutral-500">
                  Outlook Mail &amp; Calendar
                </span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-neutral-500" />
            </button>
          ) : (
            <button
              type="button"
              disabled
              aria-disabled="true"
              aria-label="Continue with Outlook — coming soon"
              className="flex w-full cursor-not-allowed items-center gap-4 rounded-2xl border border-border/60 bg-card/50 px-5 py-4 text-left opacity-70"
            >
              <span className="flex size-8 shrink-0 items-center justify-center">
                <OutlookIcon className="size-6" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-foreground/80">
                  Outlook
                </span>
                <span className="text-xs text-muted-foreground">
                  Outlook Mail &amp; Calendar
                </span>
              </span>
              <span className="shrink-0 rounded-full border border-border/70 bg-gradient-to-r from-muted/80 to-transparent px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Coming soon
              </span>
            </button>
          )}

          <p className="pt-1 text-center text-xs text-muted-foreground">
            You&apos;ll grant Gmail read/send, Google Calendar, and
            permanent-delete access. You can change this later in Settings →
            Connected accounts or at{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Google Account permissions
            </a>
            .
          </p>

          {showError ? (
            <p role="alert" className="text-center text-xs text-destructive">
              We couldn&apos;t connect your Google account. Please try again.
            </p>
          ) : null}

          {syncEmailErrorDetail ? (
            <p className="text-center text-[11px] text-muted-foreground">
              {syncEmailErrorDetail}
            </p>
          ) : null}
        </OnboardingContentBlock>
      </OnboardingStepAnimatedItem>
    </OnboardingStepPage>
  );
};
