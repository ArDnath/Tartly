"use client";

import { MailIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChatBriefingPart } from "@/lib/db/schema";

import { BriefingActions } from "./actions";
import { DraftPreview, KindBadge, MetaLine } from "./primitives";

/** A thread that needs a reply, with the prepared draft ready to send. */
export function ReplyCard({ part }: { part: ChatBriefingPart }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <MailIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{part.title}</span>
          <KindBadge>Reply</KindBadge>
        </CardTitle>
        {part.subtitle ? <MetaLine>{part.subtitle}</MetaLine> : null}
        {part.summary ? (
          <p className="text-[13px] leading-relaxed text-foreground/90">
            {part.summary}
          </p>
        ) : part.draftId ? (
          <MetaLine>Draft prepared — send it or edit first.</MetaLine>
        ) : null}
      </CardHeader>
      <CardContent className="gap-2.5">
        <DraftPreview body={part.body} />
        <BriefingActions part={part} />
      </CardContent>
    </Card>
  );
}
