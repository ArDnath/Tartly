"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type MeetingDialogMode =
  | { kind: "create"; startAt: string; endAt: string }
  | {
      kind: "reschedule";
      meeting: {
        id: string;
        subject: string | null;
        startAt: string | null;
        endAt: string | null;
      };
    };

const EMAIL_PATTERN = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;

function toLocalInput(iso: string | null): string {
  const date = iso ? new Date(iso) : new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Create-or-reschedule dialog. The parent remounts it (via `key`) with a fresh
 * `mode` each time it opens, so the fields seed straight from props — no
 * state-syncing effect needed.
 */
export function MeetingDialog({
  open,
  onOpenChange,
  mode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: MeetingDialogMode;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(
    mode.kind === "reschedule" ? (mode.meeting.subject ?? "Meeting") : "",
  );
  const [start, setStart] = useState(
    mode.kind === "reschedule"
      ? toLocalInput(mode.meeting.startAt)
      : toLocalInput(mode.startAt),
  );
  const [end, setEnd] = useState(
    mode.kind === "reschedule"
      ? toLocalInput(mode.meeting.endAt)
      : toLocalInput(mode.endAt),
  );
  const [attendees, setAttendees] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCreate = mode.kind === "create";

  const submit = async () => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      setError("Pick a start and end time.");
      return;
    }
    if (startDate >= endDate) {
      setError("The end time must be after the start.");
      return;
    }

    const parsedAttendees = attendees
      .split(/[,\s]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const invalid = parsedAttendees.find((email) => !EMAIL_PATTERN.test(email));
    if (invalid) {
      setError(`"${invalid}" doesn't look like an email address.`);
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      const response = isCreate
        ? await fetch("/api/v1/meetings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subject: subject.trim() || "Meeting",
              startAt: startDate.toISOString(),
              endAt: endDate.toISOString(),
              ...(parsedAttendees.length ? { attendees: parsedAttendees } : {}),
            }),
          })
        : await fetch(`/api/v1/meetings/${mode.meeting.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              startAt: startDate.toISOString(),
              endAt: endDate.toISOString(),
            }),
          });

      if (!response.ok) {
        throw new Error(
          isCreate ? "Couldn't create the meeting." : "Couldn't reschedule it.",
        );
      }

      onOpenChange(false);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Something went wrong.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isCreate ? "New meeting" : "Reschedule meeting"}
          </DialogTitle>
          <DialogDescription>
            {isCreate
              ? "Books a Google Calendar event with a Meet link."
              : "Moves the calendar event to a new time."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {isCreate ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-muted-foreground">
                Title
              </span>
              <Input
                value={subject}
                autoFocus
                placeholder="Intro call"
                onChange={(event) => setSubject(event.target.value)}
              />
            </label>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-muted-foreground">
                Starts
              </span>
              <Input
                type="datetime-local"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-muted-foreground">
                Ends
              </span>
              <Input
                type="datetime-local"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </label>
          </div>

          {isCreate ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-muted-foreground">
                Guests (optional)
              </span>
              <Input
                value={attendees}
                placeholder="ada@example.com, grace@example.com"
                onChange={(event) => setAttendees(event.target.value)}
              />
            </label>
          ) : null}

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isBusy}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={isBusy}>
            {isBusy ? <Loader2 className="size-4 animate-spin" /> : null}
            {isCreate ? "Create meeting" : "Save new time"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
