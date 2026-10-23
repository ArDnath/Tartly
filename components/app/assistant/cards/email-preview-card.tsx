"use client";

import { MailFrame } from "./mail-frame";
import { MailTable, mailRowFromRecord } from "./mail-table";
import { asRecord } from "./shared";

/**
 * A typed rendering of one `get_email` result as a single compact mail row:
 * from, subject, type and date. Clicking it opens the message in the mail
 * client — the body is not shown here. Squared and hairline-ruled to match the
 * other transcript mail artifacts.
 */
export function EmailPreviewCard({ output }: { output: unknown }) {
  const data = asRecord(output);
  if (!data) return null;

  return (
    <MailFrame>
      <MailTable rows={[mailRowFromRecord(data)]} showHeader={false} />
    </MailFrame>
  );
}
