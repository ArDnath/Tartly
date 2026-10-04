"use client";

import { Card } from "@/components/ui/card";

import { MailTable, mailRowFromRecord } from "./mail-table";
import { asRecord } from "./shared";

/**
 * A typed rendering of one `get_email` result as a single compact mail row:
 * from, subject, type and date. Clicking it opens the message in the mail
 * client — the body is not shown here.
 */
export function EmailPreviewCard({ output }: { output: unknown }) {
  const data = asRecord(output);
  if (!data) return null;

  return (
    <Card size="sm" className="w-full gap-0 py-0">
      <MailTable rows={[mailRowFromRecord(data)]} showHeader={false} />
    </Card>
  );
}
