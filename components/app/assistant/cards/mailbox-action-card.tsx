"use client";

import {
  ArchiveIcon,
  CheckCheckIcon,
  MailOpenIcon,
  StarIcon,
  TagIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";

import { AgentEmailRef } from "./email-ref";
import { asBoolean, asRecord, asString } from "./shared";

/** A one-line typed rendering of the reversible mailbox mutations. */
export function MailboxActionCard({
  toolName,
  output,
}: {
  toolName: string;
  output: unknown;
}) {
  const data = asRecord(output);
  if (!data) return null;

  const messageId = asString(data.messageId);
  const label = asString(data.label);

  const { icon, text } = describe(toolName, data, label);

  return (
    <Card size="sm">
      <CardContent className="gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{icon}</span>
          <span>{text}</span>
        </div>
        {/* The affected mail as a clickable preview instead of a raw id. */}
        {messageId ? <AgentEmailRef email={{ id: messageId }} /> : null}
      </CardContent>
    </Card>
  );
}

function describe(
  toolName: string,
  data: Record<string, unknown>,
  label: string | undefined,
): { icon: ReactNode; text: string } {
  switch (toolName) {
    case "archive_email":
      return {
        icon: <ArchiveIcon className="size-4" aria-hidden />,
        text: asBoolean(data.archived)
          ? "Archived — removed from the inbox"
          : "Archive requested",
      };
    case "mark_email_read": {
      const read = asBoolean(data.read);
      return {
        icon: read ? (
          <CheckCheckIcon className="size-4" aria-hidden />
        ) : (
          <MailOpenIcon className="size-4" aria-hidden />
        ),
        text: read ? "Marked as read" : "Marked as unread",
      };
    }
    case "add_label":
      return {
        icon: <TagIcon className="size-4" aria-hidden />,
        text: label ? `Label "${label}" applied` : "Label applied",
      };
    case "star_email":
      return {
        icon: <StarIcon className="size-4" aria-hidden />,
        text: asBoolean(data.starred) ? "Starred" : "Star removed",
      };
    case "remove_label":
      return {
        icon: <TagIcon className="size-4" aria-hidden />,
        text: label ? `Label "${label}" removed` : "Label removed",
      };
    default:
      return {
        icon: <TagIcon className="size-4" aria-hidden />,
        text: "Mailbox updated",
      };
  }
}
