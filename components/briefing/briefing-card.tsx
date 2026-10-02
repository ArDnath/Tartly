"use client";

import type { ChatBriefingPart } from "@/lib/db/schema";

import { FollowupCard } from "./followup-card";
import { MeetingCard } from "./meeting-card";
import { PromiseCard } from "./promise-card";
import { ReplyCard } from "./reply-card";

/** Dispatches one persisted briefing part to its card. */
export function BriefingCard({ part }: { part: ChatBriefingPart }) {
  switch (part.kind) {
    case "reply":
      return <ReplyCard part={part} />;
    case "followup":
      return <FollowupCard part={part} />;
    case "promise":
      return <PromiseCard part={part} />;
    case "meeting":
      return <MeetingCard part={part} />;
    default:
      return null;
  }
}
