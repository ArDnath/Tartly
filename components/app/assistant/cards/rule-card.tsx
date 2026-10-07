"use client";

import { ZapIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { asBoolean, asRecord, asString } from "./shared";

/** The rule the agent compiled from a plain-English instruction. */
export function RuleCard({ output }: { output: unknown }) {
  const data = asRecord(output);
  if (!data || asBoolean(data.created) === false) {
    return (
      <Card size="sm">
        <CardContent className="text-sm text-muted-foreground">
          {asString(data?.notice) ?? "No rule created."}
        </CardContent>
      </Card>
    );
  }

  const condition = asRecord(data.condition);
  const actions = Array.isArray(data.actions) ? data.actions : [];
  const matchedParts = [
    asString(condition?.ai),
    asString(condition?.from) ? `from ${asString(condition?.from)}` : undefined,
    asString(condition?.subject)
      ? `subject “${asString(condition?.subject)}”`
      : undefined,
  ].filter((value): value is string => Boolean(value));

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ZapIcon className="size-4 text-muted-foreground" aria-hidden />
          Rule created: {asString(data.name) ?? "Untitled"}
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-1.5 text-sm text-muted-foreground">
        {matchedParts.length ? (
          <p>When {matchedParts.join(" and ")}.</p>
        ) : null}
        <p>
          Then{" "}
          {actions
            .map((raw) => asString(asRecord(raw)?.type) ?? "action")
            .join(", ")
            .toLowerCase()}
          .
        </p>
        <p className="text-xs">
          Manage it in Settings → Rules. Any reply it drafts still needs your
          approval.
        </p>
      </CardContent>
    </Card>
  );
}
