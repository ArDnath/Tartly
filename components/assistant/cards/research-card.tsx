"use client";

import { ExternalLinkIcon, GlobeIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { asNumber, asRecord, asString } from "./shared";

/**
 * A compact rendering of web research results. The untrusted marker is
 * deliberate: the user should see that this is third-party content the agent
 * is reporting, not an instruction it followed.
 */
export function ResearchCard({ output }: { output: unknown }) {
  const data = asRecord(output);
  const pageContent = asString(data?.content);
  const rows = Array.isArray(data?.results) ? data.results : [];
  const possibleEmails = Array.isArray(data?.possibleEmails)
    ? data.possibleEmails
    : [];

  if (pageContent) {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <GlobeIcon className="size-4 text-muted-foreground" aria-hidden />
            {asString(data?.title) ?? asString(data?.url) ?? "Web page"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="max-h-56 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
            {pageContent}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card size="sm">
        <CardContent className="text-sm text-muted-foreground">
          {asString(data?.notice) ?? "No research results."}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <GlobeIcon className="size-4 text-muted-foreground" aria-hidden />
          {asNumber(data?.count) ?? rows.length} web result
          {(asNumber(data?.count) ?? rows.length) === 1 ? "" : "s"}
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-2">
        {rows.map((raw, index) => {
          const row = asRecord(raw) ?? {};
          const url = asString(row.url) ?? `result-${index}`;
          return (
            <div key={url} className="rounded-md border border-border/60 px-3 py-2">
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1 truncate text-sm font-medium hover:underline"
              >
                {asString(row.title) ?? url}
                <ExternalLinkIcon className="size-3 shrink-0" aria-hidden />
              </a>
              {asString(row.content) ? (
                <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                  {asString(row.content)}
                </p>
              ) : null}
            </div>
          );
        })}
        {possibleEmails.length > 0 ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            <p className="text-xs font-medium text-amber-700">
              Addresses found — unverified
            </p>
            <p className="text-xs text-muted-foreground">
              {possibleEmails
                .map((raw) => asString(asRecord(raw)?.email))
                .filter(Boolean)
                .join(", ")}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
