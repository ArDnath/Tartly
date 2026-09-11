"use client";

import {
  CalendarClock,
  CalendarDays,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Video,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import {
  MeetingDialog,
  type MeetingDialogMode,
} from "@/components/calendar/meeting-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AgendaMeeting } from "@/lib/calendar/agenda";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-emerald-500/10 text-emerald-400",
  proposed: "bg-amber-500/10 text-amber-400",
  cancelled: "bg-rose-500/10 text-rose-400",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
        STATUS_STYLES[status] ?? "bg-secondary text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

function formatDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(new Date(iso));
}

function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

function dayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

function formatRange(
  startAt: string,
  endAt: string | null,
  timeZone: string,
): string {
  const start = formatTime(startAt, timeZone);
  return endAt ? `${start} – ${formatTime(endAt, timeZone)}` : start;
}

function groupByDay(meetings: AgendaMeeting[], timeZone: string) {
  const groups: Array<{ key: string; label: string; items: AgendaMeeting[] }> =
    [];
  for (const meeting of meetings) {
    if (!meeting.startAt) continue;
    const key = dayKey(meeting.startAt, timeZone);
    let group = groups.find((candidate) => candidate.key === key);
    if (!group) {
      group = { key, label: formatDay(meeting.startAt, timeZone), items: [] };
      groups.push(group);
    }
    group.items.push(meeting);
  }
  return groups;
}

function MeetingRow({
  meeting,
  timeZone,
  cancelling,
  onReschedule,
  onCancel,
}: {
  meeting: AgendaMeeting;
  timeZone: string;
  cancelling: boolean;
  onReschedule: (meeting: AgendaMeeting) => void;
  onCancel: (meeting: AgendaMeeting) => void;
}) {
  const isCancelled = meeting.status === "cancelled";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-border bg-card p-4",
        isCancelled && "opacity-70",
      )}
    >
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
        <CalendarClock className="size-4" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p
            className={cn(
              "min-w-0 truncate text-[14px] font-medium text-foreground",
              isCancelled && "line-through decoration-muted-foreground",
            )}
          >
            {meeting.subject?.trim() || "Meeting"}
          </p>
          <StatusBadge status={meeting.status} />
        </div>

        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {meeting.startAt
            ? formatRange(meeting.startAt, meeting.endAt, timeZone)
            : "No time set"}
        </p>

        {(meeting.meetLink || meeting.threadId) && !isCancelled ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {meeting.meetLink ? (
              <a
                href={meeting.meetLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <Video className="size-3.5" aria-hidden />
                Join
              </a>
            ) : null}
            {meeting.threadId ? (
              <Link
                href={`/inbox/${meeting.threadId}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                View thread
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      {!isCancelled ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Meeting actions"
                className="text-muted-foreground"
              >
                {cancelling ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <MoreVertical className="size-4" />
                )}
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onReschedule(meeting)}>
              <Pencil className="size-3.5" />
              Reschedule…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onCancel(meeting)}
            >
              <XCircle className="size-3.5" />
              Cancel meeting
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function DayGroups({
  meetings,
  timeZone,
  cancellingId,
  onReschedule,
  onCancel,
}: {
  meetings: AgendaMeeting[];
  timeZone: string;
  cancellingId: string | null;
  onReschedule: (meeting: AgendaMeeting) => void;
  onCancel: (meeting: AgendaMeeting) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {groupByDay(meetings, timeZone).map((group) => (
        <div key={group.key} className="flex flex-col gap-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label}
          </h3>
          <div className="flex flex-col gap-2">
            {group.items.map((meeting) => (
              <MeetingRow
                key={meeting.id}
                meeting={meeting}
                timeZone={timeZone}
                cancelling={cancellingId === meeting.id}
                onReschedule={onReschedule}
                onCancel={onCancel}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function createDialogMode(): MeetingDialogMode {
  const base = new Date();
  base.setHours(base.getHours() + 1, 0, 0, 0);
  const end = new Date(base.getTime() + 30 * 60_000);
  return {
    kind: "create",
    startAt: base.toISOString(),
    endAt: end.toISOString(),
  };
}

export function MeetingAgenda({
  upcoming,
  past,
  unscheduled,
  cancelled,
  timeZone,
}: {
  upcoming: AgendaMeeting[];
  past: AgendaMeeting[];
  unscheduled: AgendaMeeting[];
  cancelled: AgendaMeeting[];
  timeZone: string;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{
    open: boolean;
    key: number;
    mode: MeetingDialogMode;
  }>(() => ({ open: false, key: 0, mode: createDialogMode() }));
  const [pendingCancel, setPendingCancel] = useState<AgendaMeeting | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const total =
    upcoming.length + past.length + unscheduled.length + cancelled.length;

  const openReschedule = (meeting: AgendaMeeting) =>
    setDialog((current) => ({
      open: true,
      key: current.key + 1,
      mode: {
        kind: "reschedule",
        meeting: {
          id: meeting.id,
          subject: meeting.subject,
          startAt: meeting.startAt,
          endAt: meeting.endAt,
        },
      },
    }));

  const confirmCancel = async () => {
    if (!pendingCancel) return;
    const meeting = pendingCancel;
    setCancellingId(meeting.id);
    setCancelError(null);
    try {
      const response = await fetch(`/api/v1/meetings/${meeting.id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Couldn't cancel that meeting.");
      setPendingCancel(null);
      router.refresh();
    } catch (error) {
      setCancelError(
        error instanceof Error ? error.message : "Couldn't cancel that meeting.",
      );
    } finally {
      setCancellingId(null);
    }
  };

  const rowActions = {
    onReschedule: openReschedule,
    onCancel: (meeting: AgendaMeeting) => {
      setCancelError(null);
      setPendingCancel(meeting);
    },
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-foreground">Agenda</h2>
        <Button
          type="button"
          size="sm"
          onClick={() =>
            setDialog((current) => ({
              open: true,
              key: current.key + 1,
              mode: createDialogMode(),
            }))
          }
        >
          <Plus className="size-3.5" />
          New meeting
        </Button>
      </div>

      {total === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
          <CalendarDays
            className="size-8 text-muted-foreground/60"
            aria-hidden
          />
          <p className="text-[15px] font-medium text-foreground">
            No meetings booked yet
          </p>
          <p className="max-w-xs text-[13px] text-muted-foreground">
            Book one with “New meeting”, or ask your assistant to schedule one.
          </p>
        </div>
      ) : (
        <>
          <Section title="Upcoming">
            {upcoming.length > 0 ? (
              <DayGroups
                meetings={upcoming}
                timeZone={timeZone}
                cancellingId={cancellingId}
                {...rowActions}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
                Nothing scheduled ahead.
              </p>
            )}
          </Section>

          {unscheduled.length > 0 ? (
            <Section title="Not scheduled">
              <div className="flex flex-col gap-2">
                {unscheduled.map((meeting) => (
                  <MeetingRow
                    key={meeting.id}
                    meeting={meeting}
                    timeZone={timeZone}
                    cancelling={cancellingId === meeting.id}
                    {...rowActions}
                  />
                ))}
              </div>
            </Section>
          ) : null}

          {past.length > 0 ? (
            <Section title="Past">
              <DayGroups
                meetings={past}
                timeZone={timeZone}
                cancellingId={cancellingId}
                {...rowActions}
              />
            </Section>
          ) : null}

          {cancelled.length > 0 ? (
            <Section title="Cancelled">
              <div className="flex flex-col gap-2">
                {cancelled.map((meeting) => (
                  <MeetingRow
                    key={meeting.id}
                    meeting={meeting}
                    timeZone={timeZone}
                    cancelling={cancellingId === meeting.id}
                    {...rowActions}
                  />
                ))}
              </div>
            </Section>
          ) : null}
        </>
      )}

      <MeetingDialog
        key={dialog.key}
        open={dialog.open}
        mode={dialog.mode}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
      />

      <Dialog
        open={pendingCancel !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCancel(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this meeting?</DialogTitle>
            <DialogDescription>
              {pendingCancel?.subject?.trim() || "This meeting"} will be removed
              from Google Calendar and marked cancelled here.
            </DialogDescription>
          </DialogHeader>
          {cancelError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {cancelError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingCancel(null)}
              disabled={cancellingId !== null}
            >
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmCancel()}
              disabled={cancellingId !== null}
            >
              {cancellingId ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Cancel meeting
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
