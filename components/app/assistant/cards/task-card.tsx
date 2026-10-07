"use client";

import { CheckSquareIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { asNumber, asRecord, asString } from "./shared";

/** A compact rendering of `extract_tasks` results. */
export function TaskCard({ output }: { output: unknown }) {
  const data = asRecord(output);
  const tasks = Array.isArray(data?.tasks) ? data.tasks : [];

  if (tasks.length === 0) {
    return (
      <Card size="sm">
        <CardContent className="text-sm text-muted-foreground">
          {asString(data?.notice) ?? "No action items found."}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <CheckSquareIcon className="size-4 text-muted-foreground" aria-hidden />
          {asNumber(data?.count) ?? tasks.length} action item
          {(asNumber(data?.count) ?? tasks.length) === 1 ? "" : "s"}
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-2">
        {tasks.map((raw, index) => {
          const task = asRecord(raw) ?? {};
          const text = asString(task.text) ?? `Task ${index + 1}`;
          const due = asString(task.dueHint);
          return (
            <label
              key={`${index}:${text}`}
              className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2 text-sm"
            >
              <span className="mt-0.5 size-4 shrink-0 rounded border border-border" />
              <span className="min-w-0">
                <span className="block">{text}</span>
                {due ? (
                  <span className="text-xs text-muted-foreground">Due {due}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </CardContent>
    </Card>
  );
}
