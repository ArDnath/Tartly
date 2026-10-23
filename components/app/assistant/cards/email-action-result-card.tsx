"use client";

import { CalendarClockIcon, CheckCircle2Icon, MailCheckIcon, ReplyIcon, Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { AgentEmailRef, type EmailReference } from "./email-ref";
import {
  asBoolean,
  asRecord,
  asString,
  asStringList,
  formatTimestamp,
} from "./shared";

/**
 * The receipt for a side effect the agent executed — either because the user
 * approved it in Copilot, or because Autopilot ran it directly. It is the
 * thread-visible half of an auto-reply: it names the conversation it landed in
 * and shows what went out.
 */

const TITLES: Record<string, string> = {
  send_email: "Email sent",
  reply_to_email: "Reply sent",
  forward_email: "Message forwarded",
  delete_email: "Moved to trash",
  schedule_email: "Send scheduled",
};

function titleFor(
  toolName: string,
  deduped: boolean,
  permanent = false,
): string {
  if (deduped) return "Already handled — not repeated";
  if (toolName === "delete_email") {
    return permanent ? "Permanently deleted" : "Moved to trash";
  }
  return TITLES[toolName] ?? "Action completed";
}

function iconFor(toolName: string): ReactNode {
  switch (toolName) {
    case "reply_to_email":
      return <ReplyIcon className="size-4 text-emerald-600" aria-hidden />;
    case "send_email":
    case "forward_email":
      return <MailCheckIcon className="size-4 text-emerald-600" aria-hidden />;
    case "schedule_email":
      return <CalendarClockIcon className="size-4 text-muted-foreground" aria-hidden />;
    case "delete_email":
      return <Trash2Icon className="size-4 text-muted-foreground" aria-hidden />;
    default:
      return <CheckCircle2Icon className="size-4 text-emerald-600" aria-hidden />;
  }
}

export function EmailActionResultCard({
  toolName,
  input,
  output,
}: {
  toolName: string;
  input: unknown;
  output: unknown;
}) {
  const result = asRecord(output) ?? {};
  const args = asRecord(input) ?? {};

  const deduped = asBoolean(result.deduped);
  const permanent = asBoolean(result.permanent);
  const to = asStringList(result.to).length
    ? asStringList(result.to)
    : asStringList(args.to);
  const subject = asString(result.subject) ?? asString(args.subject);
  const body = asString(args.body);
  const messageId = asString(result.messageId) ?? asString(args.messageId);
  const gmailMessageId = asString(result.gmailMessageId);
  const sendAt = formatTimestamp(result.runAfter ?? args.sendAt);
  const notice = asString(result.notice);

  // Which mail this receipt points at. A send/reply/forward points at what
  // actually went out (`gmailMessageId`); the reversible actions point at the
  // message they touched.
  const pointsAtSent =
    toolName === "send_email" ||
    toolName === "reply_to_email" ||
    toolName === "forward_email" ||
    toolName === "schedule_email";
  const referenceId = pointsAtSent
    ? (gmailMessageId ?? messageId)
    : messageId;
  const reference: EmailReference | null = referenceId
    ? {
        id: referenceId,
        ...(to.length ? { to } : {}),
        ...(subject ? { subject } : {}),
        ...(body ? { snippet: body } : {}),
      }
    : null;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {iconFor(toolName)}
          {titleFor(toolName, deduped, permanent)}
        </CardTitle>
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {to.length ? <p className="truncate">To: {to.join(", ")}</p> : null}
          {subject ? <p className="truncate">Subject: {subject}</p> : null}
          {sendAt ? <p className="truncate">Scheduled for: {sendAt}</p> : null}
        </div>
      </CardHeader>
      <CardContent className="gap-2">
        {toolName === "reply_to_email" ? (
          <p className="text-xs text-muted-foreground">
            Kept in the same conversation, not a new email.
          </p>
        ) : null}

        {body ? (
          <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-sm text-foreground/90">
            {body}
          </p>
        ) : null}

        {notice ? (
          <p className="text-xs text-muted-foreground">{notice}</p>
        ) : null}

        {/* The affected mail as a clickable preview instead of a raw id. */}
        {reference ? <AgentEmailRef email={reference} /> : null}
      </CardContent>
    </Card>
  );
}
