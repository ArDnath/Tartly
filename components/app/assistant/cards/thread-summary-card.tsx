"use client";

import { SparklesIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { asRecord, asString, asStringList } from "./shared";

/** A cached AI summary of a conversation. */
export function ThreadSummaryCard({ output }: { output: unknown }) {
  const data = asRecord(output);
  if (!data || data.found === false) {
    return (
      <Card size="sm">
        <CardContent className="text-sm text-muted-foreground">
          {asString(data?.notice) ?? "No summary available."}
        </CardContent>
      </Card>
    );
  }

  const summary = asString(data.summary);
  const decisions = asStringList(data.decisions);
  const actionItems = asStringList(data.actionItems);
  const openQuestions = asStringList(data.openQuestions);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <SparklesIcon className="size-4 text-muted-foreground" aria-hidden />
          Thread summary
          {asString(data.generatedBy) === "heuristic" ? (
            <span className="text-xs font-normal text-muted-foreground">
              (offline)
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-2">
        {summary ? (
          <p className="text-sm leading-relaxed text-foreground/90">{summary}</p>
        ) : null}
        <SummaryList title="Decisions" items={decisions} />
        <SummaryList title="Action items" items={actionItems} />
        <SummaryList title="Open questions" items={openQuestions} />
      </CardContent>
    </Card>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <ul className="mt-0.5 list-disc pl-4 text-xs leading-relaxed text-foreground/85">
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
