"use client";

import { ShieldOffIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { asBoolean, asRecord, asString } from "./shared";

/** The receipt for `add_suppression`: an address that will never be emailed. */
export function SuppressionCard({ output }: { output: unknown }) {
  const data = asRecord(output);
  const email = asString(data?.email) ?? "that address";

  if (!asBoolean(data?.added)) {
    return (
      <Card size="sm">
        <CardContent className="text-sm text-muted-foreground">
          Could not add {email} to the suppression list.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldOffIcon className="size-4 text-muted-foreground" aria-hidden />
          Suppressed: {email}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        No future campaign will email this address.
      </CardContent>
    </Card>
  );
}
