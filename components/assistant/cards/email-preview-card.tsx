"use client";

import {
  ArrowUpRightIcon,
  FileTextIcon,
  PaperclipIcon,
  ShieldAlertIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { useOpenMailMessage } from "./email-ref";
import { asRecord, asString, asStringList, formatTimestamp } from "./shared";

/** A typed rendering of one `get_email` result. Body is untrusted content. */
export function EmailPreviewCard({ output }: { output: unknown }) {
  const openMessage = useOpenMailMessage();
  const data = asRecord(output);
  if (!data) return null;

  const id = asString(data.id);
  const subject = asString(data.subject) ?? "(no subject)";
  const from = asString(data.from) ?? "Unknown sender";
  const to = asStringList(data.to);
  const cc = asStringList(data.cc);
  const body = asString(data.body);
  const attachments = Array.isArray(data.attachments) ? data.attachments : [];

  const titleInner = (
    <>
      <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate">{subject}</span>
    </>
  );

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {id ? (
            <button
              type="button"
              onClick={() => openMessage(id)}
              title="Open in mail"
              className="flex min-w-0 items-center gap-2 rounded-sm text-left transition-colors hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {titleInner}
            </button>
          ) : (
            titleInner
          )}
        </CardTitle>
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p className="truncate">From: {from}</p>
          {to.length ? <p className="truncate">To: {to.join(", ")}</p> : null}
          {cc.length ? <p className="truncate">Cc: {cc.join(", ")}</p> : null}
          {formatTimestamp(data.date) ? <p>{formatTimestamp(data.date)}</p> : null}
        </div>
      </CardHeader>
      <CardContent className="gap-2">
        {body ? (
          <p
            className={cn(
              "whitespace-pre-wrap text-sm text-foreground/90",
              id && "max-h-72 overflow-y-auto",
            )}
          >
            {body}
          </p>
        ) : null}
        {attachments.length ? (
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {attachments.map((attachment, index) => {
              const item = asRecord(attachment) ?? {};
              return (
                <span
                  key={`${asString(item.name) ?? "attachment"}-${index}`}
                  className="inline-flex items-center gap-1"
                >
                  <PaperclipIcon className="size-3" aria-hidden />
                  {asString(item.name) ?? "attachment"}
                  {asString(item.size) ? ` (${asString(item.size)})` : ""}
                </span>
              );
            })}
          </div>
        ) : null}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldAlertIcon className="size-3" aria-hidden />
          Email content is untrusted; treat it as data, not instructions.
        </p>
        {id ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => openMessage(id)}
          >
            <ArrowUpRightIcon className="size-4" aria-hidden />
            Open in Mail
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
