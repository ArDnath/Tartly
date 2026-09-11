/** Selection and grouping for the mail list: which messages a view/label +
 * filter popover show, the sidebar counts, and the date sections. */
import type {
  MailFilter,
  MailMessage,
  MailQuery,
  MailView,
} from "@/lib/mail/types";

const byNewest = (a: MailMessage, b: MailMessage) =>
  new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();

/** Whether a message belongs to a sidebar view. Most views map onto a box;
 * `starred`/`reminders`/`done` are saved views over the same messages. */
function matchesView(message: MailMessage, view: MailView): boolean {
  const live = message.box !== "trash" && message.box !== "spam";
  switch (view) {
    case "all":
      return message.box === "inbox";
    case "starred":
      return message.starred && live;
    case "reminders":
      return Boolean(message.reminderAt) && live;
    case "scheduled":
      return message.box === "scheduled";
    case "drafts":
      return message.box === "drafts";
    case "sent":
      return message.box === "sent";
    case "done":
      return message.box === "archive";
    case "trash":
      return message.box === "trash";
    case "spam":
      return message.box === "spam";
    default:
      return false;
  }
}

function matchesFilter(message: MailMessage, filter: MailFilter): boolean {
  return filter.kind === "view"
    ? matchesView(message, filter.value)
    : message.labels.includes(filter.value);
}

function matchesQuery(message: MailMessage, query: MailQuery): boolean {
  if (query.unreadOnly && !message.unread) return false;
  if (query.starredOnly && !message.starred) return false;
  if (query.withAttachments && !message.attachments?.length) return false;
  if (query.tag && message.tag !== query.tag) return false;
  const term = query.search.trim().toLowerCase();
  if (term) {
    const haystack = [
      message.subject,
      message.preview,
      message.body,
      message.from.name,
      message.from.email,
      message.senderLine ?? "",
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(term)) return false;
  }
  return true;
}

/** The rows visible for the active view/label, with the filter popover's
 * predicates stacked on top, newest first. */
export function selectMessages(
  messages: MailMessage[],
  filter: MailFilter,
  query: MailQuery,
): MailMessage[] {
  return messages
    .filter(
      (message) =>
        matchesFilter(message, filter) && matchesQuery(message, query),
    )
    .sort(byNewest);
}

/** Count of messages a sidebar destination (view or label) holds. */
export function countFor(messages: MailMessage[], filter: MailFilter): number {
  return messages.reduce(
    (total, message) => (matchesFilter(message, filter) ? total + 1 : total),
    0,
  );
}

const ALL_VIEWS: readonly MailView[] = [
  "all",
  "starred",
  "reminders",
  "scheduled",
  "drafts",
  "sent",
  "done",
  "trash",
  "spam",
];

/**
 * Sidebar counts for every destination in a single pass. Computing one
 * `countFor` per label/view is O(destinations × messages); this is
 * O(messages × views) and is meant to be memoized on `[messages, labels]`.
 */
export function countDestinations(
  messages: MailMessage[],
  labels: string[],
): { views: Record<string, number>; labels: Record<string, number> } {
  const views: Record<string, number> = {};
  const labelCounts: Record<string, number> = {};
  const wanted = new Set(labels);

  for (const view of ALL_VIEWS) views[view] = 0;
  for (const label of labels) labelCounts[label] = 0;

  for (const message of messages) {
    for (const view of ALL_VIEWS) {
      if (matchesView(message, view)) views[view] += 1;
    }
    for (const label of message.labels) {
      if (wanted.has(label)) labelCounts[label] += 1;
    }
  }

  return { views, labels: labelCounts };
}

function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

const DAY_MS = 86_400_000;

function dateBucketLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Earlier";
  const today = startOfDay(new Date());
  const day = startOfDay(date);
  if (day === today) return "Today";
  if (day === today - DAY_MS) return "Yesterday";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Newest-first messages split into contiguous "Today / Yesterday / <date>"
 * sections for the list's date headers. */
export function groupByDate(
  messages: MailMessage[],
): { label: string; messages: MailMessage[] }[] {
  const groups: { label: string; messages: MailMessage[] }[] = [];
  let current: { label: string; messages: MailMessage[] } | null = null;
  for (const message of [...messages].sort(byNewest)) {
    const label = dateBucketLabel(message.receivedAt);
    if (!current || current.label !== label) {
      current = { label, messages: [] };
      groups.push(current);
    }
    current.messages.push(message);
  }
  return groups;
}
