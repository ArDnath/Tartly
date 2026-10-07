"use client";

import { HandshakeIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChatBriefingPart } from "@/lib/db/schema";

import { BriefingActions } from "./actions";
import { DraftPreview, KindBadge, MetaLine } from "./primitives";

/** A promise in either direction; overdue ones carry a chaser/reminder draft. */
export function PromiseCard({ part }: { part: ChatBriefingPart }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <HandshakeIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{part.title}</span>
          <KindBadge>Promise</KindBadge>
        </CardTitle>
        {part.subtitle ? <MetaLine>{part.subtitle}</MetaLine> : null}
        {part.summary ? <MetaLine>{part.summary}</MetaLine> : null}
      </CardHeader>
      <CardContent className="gap-2.5">
        <DraftPreview body={part.body} />
        <BriefingActions part={part} />
      </CardContent>
    </Card>
  );
}
