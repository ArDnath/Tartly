"use client";

import { PenLineIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { asRecord, asString, asStringList } from "./shared";

const CONFIDENCE_LABEL: Record<string, string> = {
  LOW: "Low confidence",
  MEDIUM: "Medium confidence",
  HIGH: "High confidence",
};

/** A draft written in the user's learned voice — saved, never sent. */
export function VoiceDraftCard({ output }: { output: unknown }) {
  const data = asRecord(output);
  const to = asStringList(data?.to);
  const confidence = asString(data?.confidence);
  const body = asString(data?.bodyPreview);
  const notice =
    asString(data?.notice) ?? "Draft saved to the mailbox. It has not been sent.";

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <PenLineIcon className="size-4 text-muted-foreground" aria-hidden />
          Draft in your voice
          {confidence ? (
            <span className="ml-auto text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
              {CONFIDENCE_LABEL[confidence] ?? confidence}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-2">
        {(to.length > 0 || asString(data?.subject)) && (
          <p className="text-xs text-muted-foreground">
            {to.length > 0 ? `To: ${to.join(", ")}` : null}
            {to.length > 0 && asString(data?.subject) ? " · " : null}
            {asString(data?.subject)}
          </p>
        )}
        {body ? (
          <p className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md border border-border/60 px-3 py-2 text-xs text-foreground">
            {body}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{notice}</p>
      </CardContent>
    </Card>
  );
}
