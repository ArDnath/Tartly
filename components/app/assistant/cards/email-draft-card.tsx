"use client";

import { FilePenIcon, InfoIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { asRecord, asString, asStringList } from "./shared";

/** A typed rendering of `create_draft` / `update_draft` results. */
export function EmailDraftCard({
  toolName,
  output,
}: {
  toolName: string;
  output: unknown;
}) {
  const data = asRecord(output);
  if (!data) return null;

  const created = toolName === "create_draft";
  const to = asStringList(data.to);
  const subject = asString(data.subject) ?? "(no subject)";
  const bodyPreview = asString(data.bodyPreview);
  const bodyChars = typeof data.bodyChars === "number" ? data.bodyChars : undefined;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <FilePenIcon className="size-4 text-muted-foreground" aria-hidden />
          {created ? "Draft saved" : "Draft updated"}
        </CardTitle>
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {to.length ? <p className="truncate">To: {to.join(", ")}</p> : null}
          <p className="truncate">Subject: {subject}</p>
        </div>
      </CardHeader>
      <CardContent className="gap-2">
        {bodyPreview ? (
          <p className="whitespace-pre-wrap text-sm text-foreground/90">
            {bodyPreview}
          </p>
        ) : null}
        {bodyChars !== undefined ? (
          <p className="text-xs text-muted-foreground">{bodyChars} characters</p>
        ) : null}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <InfoIcon className="size-3" aria-hidden />
          Saved to your mailbox — not sent.
        </p>
      </CardContent>
    </Card>
  );
}
