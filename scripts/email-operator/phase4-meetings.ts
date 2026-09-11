import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "../../lib/db";
import {
  drafts,
  flowRuns,
  flows,
  meetings,
  messages,
  threads,
} from "../../lib/db/schema";
import { buildProposalId, computeFreeSlots, overlapsBusy } from "../../lib/calendar/slots";
import {
  formatSlotLabel,
  getIsoWeekday,
  zonedTimeToUtc,
} from "../../lib/calendar/tz";
import { bookSlot, getThreadProposal } from "../../lib/calendar/booking";
import { createMeetingForProposal } from "../../lib/calendar/meetings";
import { detectMeetingIntent } from "../../lib/engine/steps/detect-meeting-intent";
import { ensureMailbox } from "../../lib/email-operator/mailbox";
import {
  assert,
  createTestUser,
  deleteTestUser,
  makeTestUserId,
  section,
} from "./harness";

const UTC_SETTINGS = {
  timeZone: "UTC",
  workDays: [1, 2, 3, 4, 5],
  workStartHour: 9,
  workEndHour: 17,
  bufferMins: 15,
  durationMins: 30,
};

export async function run(): Promise<void> {
  section("phase 4 — timezone math");
  const nyMorning = zonedTimeToUtc(
    { year: 2025, month: 1, day: 6, hour: 9, minute: 0 },
    "America/New_York",
  );
  assert(
    nyMorning.toISOString() === "2025-01-06T14:00:00.000Z",
    "EST morning maps to UTC (-5)",
  );

  const beforeDst = zonedTimeToUtc(
    { year: 2025, month: 3, day: 8, hour: 9, minute: 0 },
    "America/New_York",
  );
  const afterDst = zonedTimeToUtc(
    { year: 2025, month: 3, day: 10, hour: 9, minute: 0 },
    "America/New_York",
  );
  assert(
    beforeDst.toISOString() === "2025-03-08T14:00:00.000Z",
    "day before DST is EST (-5)",
  );
  assert(
    afterDst.toISOString() === "2025-03-10T13:00:00.000Z",
    "day after DST is EDT (-4)",
  );
  assert(
    getIsoWeekday(new Date("2025-01-06T12:00:00Z"), "UTC") === 1,
    "Monday is ISO weekday 1",
  );
  assert(
    formatSlotLabel(new Date("2025-01-06T14:00:00Z"), "UTC").includes("UTC"),
    "slot label includes the timezone",
  );

  section("phase 4 — slot math");
  const now = new Date("2025-01-06T00:00:00Z"); // Monday 00:00 UTC
  const busy = [
    {
      start: new Date("2025-01-06T10:00:00Z"),
      end: new Date("2025-01-06T10:30:00Z"),
    },
  ];
  assert(
    overlapsBusy(
      new Date("2025-01-06T10:20:00Z"),
      new Date("2025-01-06T10:50:00Z"),
      busy,
      0,
    ),
    "overlapping interval detected",
  );

  const slots = computeFreeSlots({ now, settings: UTC_SETTINGS, busy, count: 3 });
  assert(slots.length === 3, "returns the requested number of slots");
  assert(
    slots[0].startUtc.toISOString() === "2025-01-06T09:00:00.000Z",
    "first slot starts at work start",
  );
  assert(
    slots.every(
      (slot) =>
        !overlapsBusy(slot.startUtc, slot.endUtc, busy, UTC_SETTINGS.bufferMins),
    ),
    "no slot overlaps busy time (with buffer)",
  );
  assert(
    slots.every((slot) => slot.endUtc.getTime() > slot.startUtc.getTime()),
    "slots have positive duration",
  );

  // 09:45 and 10:30 fall inside the busy block + buffer; the next slot is 11:15.
  assert(
    slots[1].startUtc.toISOString() === "2025-01-06T11:15:00.000Z",
    "busy block is skipped and slots resume after the buffer",
  );

  const saturday = new Date("2025-01-04T00:00:00Z");
  const weekendSlots = computeFreeSlots({
    now: saturday,
    settings: UTC_SETTINGS,
    busy: [],
    count: 1,
  });
  assert(
    weekendSlots[0].startUtc.toISOString() === "2025-01-06T09:00:00.000Z",
    "weekend rolls forward to Monday",
  );

  const proposalA = buildProposalId("thread-1", slots);
  const proposalB = buildProposalId("thread-1", slots);
  const proposalC = buildProposalId("thread-2", slots);
  assert(proposalA === proposalB, "proposal id is stable");
  assert(proposalA !== proposalC, "proposal id differs per thread");

  section("phase 4 — meeting intent");
  assert(
    detectMeetingIntent({ subject: null, body: "Let's have a call next week" })
      .isMeeting,
    "meeting keyword detected",
  );
  assert(
    detectMeetingIntent({ subject: null, body: "Invoice attached" }).isMeeting ===
      false,
    "non-meeting text is not a meeting",
  );
  assert(
    detectMeetingIntent({
      subject: null,
      body: "Can we schedule a 45 minutes sync?",
    }).durationMins === 45,
    "explicit duration is parsed",
  );

  const userId = makeTestUserId("phase4");
  await createTestUser(userId);

  try {
    const startUtc = new Date("2025-01-06T09:00:00Z");
    const endUtc = new Date("2025-01-06T09:30:00Z");

    section("phase 4 — one event per proposal");
    const mailbox = await ensureMailbox({ userId, email: `${userId}@example.com` });
    const threadId = nanoid();
    await db.insert(threads).values({
      id: threadId,
      mailboxId: mailbox.id,
      userId,
      gmailThreadId: "p4-thr",
      subject: "Planning",
      lastMessageAt: new Date(),
    });
    await db.insert(messages).values({
      id: nanoid(),
      threadId,
      gmailMessageId: "p4-msg",
      direction: "inbound",
      fromAddr: "ada@example.com",
      subject: "Planning",
      bodyText: "Can we meet?",
      sentAt: new Date(),
    });

    let created = 0;
    const creator = async () => {
      created += 1;
      return { id: `evt-${created}`, htmlLink: null, meetLink: "https://meet/x" };
    };

    const first = await createMeetingForProposal({
      userId,
      threadId,
      proposalId: "prop-p4",
      subject: "Sync",
      startUtc,
      endUtc,
      timeZone: "UTC",
      createEvent: creator,
    });
    const second = await createMeetingForProposal({
      userId,
      threadId,
      proposalId: "prop-p4",
      subject: "Sync",
      startUtc,
      endUtc,
      timeZone: "UTC",
      createEvent: creator,
    });
    assert(first.id === second.id, "re-booking returns the same meeting");
    assert(created === 1, "calendar event is created exactly once");
    assert(first.status === "confirmed", "meeting is confirmed");

    const rows = await db
      .select()
      .from(meetings)
      .where(eq(meetings.threadId, threadId));
    assert(rows.length === 1, "one meeting row per proposal");

    section("phase 4 — proposal recovery + booking");
    const flowRow = await db
      .insert(flows)
      .values({ id: nanoid(), userId, name: "p4", graph: {} })
      .returning();
    const runRow = await db
      .insert(flowRuns)
      .values({
        id: nanoid(),
        userId,
        flowId: flowRow[0].id,
        triggerKind: "test",
        status: "completed",
        state: {
          proposalId: "prop-p4b",
          slotInstants: [
            { startUtc: startUtc.toISOString(), endUtc: endUtc.toISOString() },
          ],
          options: ["Mon 09:00 (UTC)"],
        },
      })
      .returning();
    await db.insert(drafts).values({
      id: nanoid(),
      userId,
      threadId,
      runId: runRow[0].id,
      body: "Proposed times...",
      status: "pending",
    });

    const proposal = await getThreadProposal(threadId);
    assert(proposal?.proposalId === "prop-p4b", "proposal recovered from the run");
    assert(proposal?.slots[0].label === "Mon 09:00 (UTC)", "slot label recovered");

    let booked = 0;
    const meeting = await bookSlot({
      userId,
      threadId,
      slotIndex: 0,
      createEvent: async () => {
        booked += 1;
        return { id: "evt-book", htmlLink: null, meetLink: "https://meet/book" };
      },
    });
    assert(meeting?.threadId === threadId, "bookSlot books the proposed slot");
    assert(booked === 1, "bookSlot creates one event");

    const rebooked = await bookSlot({
      userId,
      threadId,
      slotIndex: 0,
      createEvent: async () => {
        booked += 1;
        return { id: "evt-book-2", htmlLink: null, meetLink: null };
      },
    });
    assert(rebooked?.id === meeting?.id, "re-booking is idempotent");
    assert(booked === 1, "re-booking does not create a second event");

    const scoped = await bookSlot({
      userId: "someone-else",
      threadId,
      slotIndex: 0,
    });
    assert(scoped === null, "booking is user-scoped");
  } finally {
    await db.delete(meetings).where(eq(meetings.userId, userId));
    await db.delete(flows).where(eq(flows.userId, userId));
    await deleteTestUser(userId);
  }
}
