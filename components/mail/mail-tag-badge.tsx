import { cn } from "@/lib/utils";
import type { MailTag } from "@/lib/mail/types";

const TAG_STYLES: Record<MailTag, string> = {
  important: "bg-mail-tag-important text-mail-tag-important-foreground",
  newsletter: "bg-mail-tag-newsletter text-mail-tag-newsletter-foreground",
  calendar: "bg-mail-tag-calendar text-mail-tag-calendar-foreground",
  other: "bg-mail-chip text-mail-chip-foreground",
};

const TAG_LABELS: Record<MailTag, string> = {
  important: "Important",
  newsletter: "Newsletter",
  calendar: "Calendar",
  other: "Other",
};

export function MailTagBadge({
  tag,
  className,
}: {
  tag: MailTag;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm px-2 py-[3px] text-[11px] font-medium whitespace-nowrap",
        TAG_STYLES[tag],
        className,
      )}
    >
      {TAG_LABELS[tag]}
    </span>
  );
}
