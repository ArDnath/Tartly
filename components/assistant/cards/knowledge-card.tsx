"use client";

import { BookOpenIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { asRecord, asString } from "./shared";

/** Knowledge entries the agent pulled from the user's saved facts. */
export function KnowledgeCard({ output }: { output: unknown }) {
  const data = asRecord(output);
  const entries = Array.isArray(data?.entries) ? data.entries : [];

  if (entries.length === 0) {
    return (
      <Card size="sm">
        <CardContent className="text-sm text-muted-foreground">
          {asString(data?.notice) ?? "No matching knowledge entries."}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <BookOpenIcon className="size-4 text-muted-foreground" aria-hidden />
          {entries.length} knowledge{" "}
          {entries.length === 1 ? "entry" : "entries"}
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-2">
        {entries.map((raw, index) => {
          const row = asRecord(raw) ?? {};
          return (
            <div
              key={asString(row.id) ?? `entry-${index}`}
              className="rounded-md border border-border/60 px-3 py-2"
            >
              <p className="text-sm font-medium">
                {asString(row.title) ?? "Untitled"}
              </p>
              {asString(row.content) ? (
                <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">
                  {asString(row.content)}
                </p>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
