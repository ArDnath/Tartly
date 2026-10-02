"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ChatBriefingPart } from "@/lib/db/schema";

type Brief = NonNullable<ChatBriefingPart["brief"]>;

function Section({
  title,
  items,
}: {
  title: string;
  items: string[] | undefined;
}) {
  if (!items || items.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      <ul className="flex flex-col gap-1">
        {items.map((item, index) => (
          <li key={index} className="flex gap-2 text-[13px] leading-relaxed">
            <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/60" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The meeting brief in a dialog: objective, agenda, questions, open items. */
export function MeetingBriefSheet({
  brief,
  subject,
  open,
  onOpenChange,
}: {
  brief: Brief | null;
  subject: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">
            {subject ?? "Meeting brief"}
          </DialogTitle>
          {brief?.attendees?.length ? (
            <DialogDescription>
              With {brief.attendees.join(", ")}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {brief ? (
          <div className="flex flex-col gap-4">
            {brief.objective ? (
              <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[13px] font-medium">
                {brief.objective}
              </p>
            ) : null}
            <p className="text-[13px] leading-relaxed text-foreground/90">
              {brief.summary}
            </p>
            <Section title="Agenda" items={brief.agenda} />
            <Section title="Talking points" items={brief.talkingPoints} />
            <Section title="Outstanding questions" items={brief.outstandingQuestions} />
            {brief.lastProposal ? (
              <section className="flex flex-col gap-1">
                <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Last proposal
                </h4>
                <p className="text-[13px] leading-relaxed">{brief.lastProposal}</p>
              </section>
            ) : null}
            <Section title="Open items" items={brief.openItems} />
            {brief.relevantEmails?.length ? (
              <section className="flex flex-col gap-1">
                <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Related email
                </h4>
                <ul className="flex flex-col gap-1">
                  {brief.relevantEmails.map((email) => (
                    <li key={email.threadId} className="truncate text-[13px]">
                      {email.subject ?? "(no subject)"}
                      {email.when ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {email.when.slice(0, 10)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Preparing the brief…
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
