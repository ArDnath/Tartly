import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db, pool } from "../../lib/db";
import { followupEnrollments, messages, threads } from "../../lib/db/schema";
import { nextDeliverableTime, isUnreachableAddress } from "../../lib/followup/rules";
import {
  enqueueDueFollowups,
  enrollThread,
  listFollowups,
  pauseEnrollment,
  processFollowupEnrollment,
  reactivityOnInbound,
  stopEnrollment,
} from "../../lib/followup/service";
import { ensureMailbox } from "../../lib/email-operator/mailbox";
import {
  assert,
  createTestUser,
  deleteTestUser,
  makeTestUserId,
  section,
} from "./harness";

const WINDOW = {
  timeZone: "UTC",
  workDays: [1, 2, 3, 4, 5],
  workStartHour: 9,
  quietEndHour: 18,
};

async function seedThread({
  userId,
  mailboxId,
  gmailThreadId,
  from,
}: {
  userId: string;
  mailboxId: string;
  gmailThreadId: string;
  from: string;
}) {
  const threadId = nanoid();
  await db.insert(threads).values({
    id: threadId,
    mailboxId,
    userId,
    gmailThreadId,
    subject: "Following up",
    lastMessageAt: new Date(),
  });
  await db.insert(messages).values({
    id: nanoid(),
    threadId,
    gmailMessageId: `${gmailThreadId}-m1`,
    direction: "inbound",
    fromAddr: from,
    subject: "Following up",
    bodyText: "Any update?",
    sentAt: new Date(),
  });
  return threadId;
}

export async function run(): Promise<void> {
  section("phase 5 — follow-up rules");
  assert(isUnreachableAddress("mailer-daemon@example.com"), "bounce sender excluded");
  assert(isUnreachableAddress("no-reply@example.com"), "no-reply excluded");
  assert(isUnreachableAddress("bounce+123@example.com"), "plus-tagged bounce excluded");
  assert(isUnreachableAddress(null), "null address excluded");
  assert(!isUnreachableAddress("ada@example.com"), "a human address is reachable");

  assert(
    nextDeliverableTime(new Date("2025-01-04T12:00:00Z"), WINDOW).toISOString() ===
      "2025-01-06T09:00:00.000Z",
    "weekend defers to Monday morning",
  );
  assert(
    nextDeliverableTime(new Date("2025-01-06T20:00:00Z"), WINDOW).toISOString() ===
      "2025-01-07T09:00:00.000Z",
    "after-hours defers to next morning",
  );
  assert(
    nextDeliverableTime(new Date("2025-01-06T07:00:00Z"), WINDOW).toISOString() ===
      "2025-01-06T09:00:00.000Z",
    "before-hours moves to work start",
  );
  const midday = new Date("2025-01-06T12:00:00Z");
  assert(
    nextDeliverableTime(midday, WINDOW).getTime() === midday.getTime(),
    "in-hours time is unchanged",
  );

  const userId = makeTestUserId("phase5");
  await createTestUser(userId);

  try {
    const mailbox = await ensureMailbox({ userId, email: `${userId}@example.com` });
    await pool.query("delete from job_queue where user_id = $1", [userId]);

    section("phase 5 — enrollment lifecycle");
    const threadId = await seedThread({
      userId,
      mailboxId: mailbox.id,
      gmailThreadId: "p5-thr-1",
      from: "ada@example.com",
    });

    const enrollment = await enrollThread({ userId, threadId, afterDays: 3 });
    assert(Boolean(enrollment?.id), "thread enrolled");
    assert(enrollment?.status === "active", "enrollment is active");
    assert(
      enrollment?.nextEvalAt !== null &&
        enrollment!.nextEvalAt!.getTime() > Date.now(),
      "next evaluation is in the future",
    );

    const again = await enrollThread({ userId, threadId, afterDays: 3 });
    assert(again?.id === enrollment?.id, "enrollment is idempotent per thread");

    const first = await processFollowupEnrollment(enrollment!.id);
    assert(first?.attempts === 1, "processing advances the attempt count");
    assert(first?.status === "active", "still active before the cap");

    await processFollowupEnrollment(enrollment!.id);
    const third = await processFollowupEnrollment(enrollment!.id);
    assert(third?.attempts === 3, "third attempt reaches the cap");
    assert(third?.status === "completed", "enrollment completes at the cap");

    const items = await listFollowups(userId);
    assert(
      items.some((item) => item.id === enrollment!.id && item.attempts === 3),
      "list reports the enrollment state",
    );

    section("phase 5 — stop rules");
    const replyThread = await seedThread({
      userId,
      mailboxId: mailbox.id,
      gmailThreadId: "p5-thr-2",
      from: "bob@example.com",
    });
    const replyEnrollment = await enrollThread({ userId, threadId: replyThread });
    const stopped = await reactivityOnInbound(replyThread);
    assert(stopped === 1, "inbound reply stops the enrollment");
    const stoppedRow = await db
      .select()
      .from(followupEnrollments)
      .where(eq(followupEnrollments.id, replyEnrollment!.id));
    assert(stoppedRow[0].status === "stopped", "enrollment marked stopped");
    assert(stoppedRow[0].stopReason === "replied", "stop reason is recorded");

    const unreachableThread = await seedThread({
      userId,
      mailboxId: mailbox.id,
      gmailThreadId: "p5-thr-3",
      from: "no-reply@example.com",
    });
    const skipped = await enrollThread({ userId, threadId: unreachableThread });
    assert(skipped === null, "unreachable recipient is never enrolled");

    section("phase 5 — pause / resume / stop");
    const manualThread = await seedThread({
      userId,
      mailboxId: mailbox.id,
      gmailThreadId: "p5-thr-4",
      from: "carol@example.com",
    });
    const manual = await enrollThread({ userId, threadId: manualThread });
    const paused = await pauseEnrollment({
      userId,
      enrollmentId: manual!.id,
      paused: true,
    });
    assert(paused?.status === "paused", "enrollment can be paused");
    const resumed = await pauseEnrollment({
      userId,
      enrollmentId: manual!.id,
      paused: false,
    });
    assert(resumed?.status === "active", "enrollment can be resumed");
    const manualStop = await stopEnrollment({
      userId,
      enrollmentId: manual!.id,
      reason: "manual",
    });
    assert(manualStop, "enrollment can be stopped");

    section("phase 5 — due fan-out");
    const dueThread = await seedThread({
      userId,
      mailboxId: mailbox.id,
      gmailThreadId: "p5-thr-5",
      from: "dave@example.com",
    });
    const due = await enrollThread({ userId, threadId: dueThread });
    await db
      .update(followupEnrollments)
      .set({ nextEvalAt: new Date(Date.now() - 60_000) })
      .where(eq(followupEnrollments.id, due!.id));

    const enqueued = await enqueueDueFollowups();
    assert(enqueued >= 1, "due enrollment is enqueued");

    const queueRows = await pool.query(
      "select id from job_queue where user_id = $1 and kind = 'followup'",
      [userId],
    );
    assert(queueRows.rows.length >= 1, "a followup job exists");

    const enqueuedAgain = await enqueueDueFollowups();
    assert(enqueuedAgain === 0, "re-running the fan-out does not duplicate");

    await pool.query("delete from job_queue where user_id = $1", [userId]);
  } finally {
    await pool.query("delete from job_queue where user_id = $1", [userId]);
    await db.delete(followupEnrollments).where(eq(followupEnrollments.userId, userId));
    await deleteTestUser(userId);
  }
}
