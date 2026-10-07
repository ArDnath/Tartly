"use client";

import { BellOffIcon, ShieldCheckIcon, UserIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { asBoolean, asNumber, asRecord, asString } from "./shared";

/** What the assistant knows about a sender: category, cold score, unsubscribe. */
export function SenderProfileCard({ output }: { output: unknown }) {
  const data = asRecord(output);
  if (!data || data.found === false) {
    return (
      <Card size="sm">
        <CardContent className="text-sm text-muted-foreground">
          {asString(data?.notice) ?? "No sender profile found."}
        </CardContent>
      </Card>
    );
  }

  const email = asString(data.email) ?? "unknown";
  const category = asString(data.category) ?? "Other";
  const coldScore = asNumber(data.coldEmailScore) ?? 0;
  const unsubscribe = asRecord(data.unsubscribe);
  const unsubscribeMethod = asString(unsubscribe?.method) ?? "none";

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <UserIcon className="size-4 text-muted-foreground" aria-hidden />
          {email}
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-1.5 text-sm">
        <p className="flex items-center gap-2">
          <span className="text-muted-foreground">Category</span>
          <span className="font-medium">{category}</span>
        </p>
        <p className="flex items-center gap-2">
          <span className="text-muted-foreground">Cold-email score</span>
          <span className="font-medium">{coldScore}</span>
        </p>
        <p className="flex items-center gap-2">
          <BellOffIcon className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">Unsubscribe</span>
          <span className="font-medium">
            {unsubscribeMethod === "none" ? "not offered" : unsubscribeMethod}
          </span>
        </p>
        {asBoolean(data.isColdEmail) ? (
          <p className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <ShieldCheckIcon className="size-3.5" aria-hidden />
            Flagged as cold outreach
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The receipt for an unsubscribe / archive action. */
export function UnsubscribeResultCard({ output }: { output: unknown }) {
  const data = asRecord(output);
  const sender = asString(data?.senderEmail) ?? "sender";
  const method = asString(data?.method) ?? "none";
  const status = asString(data?.status) ?? "unknown";
  const notice = asString(data?.notice);
  const archived = asNumber(data?.archived) ?? 0;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <BellOffIcon className="size-4 text-muted-foreground" aria-hidden />
          Unsubscribe: {status}
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-1 text-sm text-muted-foreground">
        <p>{sender} · method: {method}</p>
        {archived > 0 ? <p>Archived {archived} message(s).</p> : null}
        {notice ? <p>{notice}</p> : null}
      </CardContent>
    </Card>
  );
}
