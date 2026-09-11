import { and, eq } from "drizzle-orm";

import { db, pool } from "../../lib/db";
import { mailboxes, messages, threads } from "../../lib/db/schema";
import { ensureMailbox, ensureMailboxForUser } from "../../lib/email-operator/mailbox";
import { recordEvent } from "../../lib/email-operator/events";
import { getJobHandler, loadJobHandlers } from "../../lib/email-operator/jobs";
import { JOB_KIND_MAILBOX_SYNC } from "../../lib/email-operator/job-kinds";
import { syncInbox } from "../../lib/inbox/service";
import { isUnreachable, parseAddressList as parseClientAddressList } from "../../lib/mail/service";
import {
  decodeBase64Url,
  decodeRfc2047,
  htmlToText,
  parseAddressList,
  parseGmailMessage,
  type GmailMessageResource,
} from "../../lib/gmail/parse";
import {
  buildMime,
  buildRawMessage,
  encodeRfc2047,
} from "../../lib/gmail/mime";
import {
  hasGrantedScopes,
  parseGrantedScopes,
} from "../../lib/onboarding/scopes";
import { sendEmail } from "../../lib/gmail/send";
import { syncMailbox, upsertParsedMessage } from "../../lib/gmail/sync";
import { registerMailboxWatch } from "../../lib/gmail/watch";
import { GOOGLE_CALENDAR_SCOPES, GOOGLE_CONNECT_SCOPES } from "../../lib/onboarding/constants";
import {
  assert,
  createTestUser,
  deleteTestUser,
  makeTestUserId,
  section,
} from "./harness";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const FIXTURE_MESSAGE: GmailMessageResource = {
  id: "msg-1",
  threadId: "thr-1",
  labelIds: ["INBOX", "UNREAD"],
  snippet: "Can we meet Tuesday?",
  internalDate: "1735689600000",
  payload: {
    mimeType: "multipart/alternative",
    headers: [
      { name: "Subject", value: "=?UTF-8?B?Q2Fmw6kgbcOpdGlu?=" },
      { name: "From", value: "Ada Lovelace <ada@example.com>" },
      { name: "To", value: '"Ops, Team" <ops@example.com>, bob@example.com' },
      { name: "Date", value: "Wed, 1 Jan 2025 00:00:00 +0000" },
    ],
    parts: [
      {
        mimeType: "text/plain",
        body: { data: Buffer.from("Hi there,\nCan we meet Tuesday?").toString("base64url") },
      },
      {
        mimeType: "text/html",
        body: { data: Buffer.from("<p>Hi there,<br>Can we meet Tuesday?</p>").toString("base64url") },
      },
    ],
  },
};

export async function run(): Promise<void> {
  section("phase 1 — scope verification");
  const fullScope = GOOGLE_CONNECT_SCOPES.join(",");
  assert(
    hasGrantedScopes(fullScope, GOOGLE_CONNECT_SCOPES),
    "full grant satisfies every connect scope",
  );
  assert(
    hasGrantedScopes(
      "https://www.googleapis.com/auth/gmail.modify, https://www.googleapis.com/auth/calendar.readonly",
      GOOGLE_CALENDAR_SCOPES,
    ) === false,
    "missing calendar.events fails calendar scope check",
  );
  assert(
    parseGrantedScopes("a, b ,c").has("b"),
    "scope parsing trims whitespace",
  );

  section("phase 1 — MIME parsing");
  assert(
    decodeBase64Url(Buffer.from("hello world").toString("base64url")) ===
      "hello world",
    "base64url round-trips",
  );
  assert(
    decodeRfc2047("=?UTF-8?B?Q2Fmw6k=?=") === "Café",
    "RFC 2047 base64 word decodes",
  );
  assert(
    decodeRfc2047("=?UTF-8?Q?Caf=C3=A9?=") === "Café",
    "RFC 2047 Q-encoded word decodes",
  );

  const addresses = parseAddressList('"Ops, Team" <ops@example.com>, bob@example.com');
  assert(addresses.length === 2, "address list splits on top-level comma");
  assert(addresses[0].name === "Ops, Team", "quoted display name preserved");
  assert(addresses[0].email === "ops@example.com", "angle-addr email parsed");
  assert(addresses[1].name === null, "bare address has no name");

  const parsed = parseGmailMessage(FIXTURE_MESSAGE);
  assert(parsed.subject === "Café métin", "subject decoded from RFC 2047");
  assert(parsed.from?.email === "ada@example.com", "from address parsed");
  assert(parsed.to.length === 2, "to list parsed");
  assert(parsed.bodyText.includes("meet Tuesday"), "plain body extracted");
  assert(
    parsed.bodyHtml?.includes("<p>") === true,
    "html body extracted from alternative",
  );
  assert(parsed.labels.includes("UNREAD"), "labels preserved");
  assert(parsed.sentAt?.getTime() === 1735689600000, "sentAt from internalDate");
  assert(
    htmlToText("<p>Hello</p><p>World &amp; friends</p>").includes(
      "World & friends",
    ),
    "htmlToText decodes entities",
  );

  section("phase 1 — MIME building");
  const raw = buildRawMessage({
    from: "ops@example.com",
    to: ["ada@example.com"],
    subject: "Café",
    text: "Hello there",
    html: "<p>Hello there</p>",
  });
  const decodedRaw = decodeBase64Url(raw);
  assert(decodedRaw.includes("From: ops@example.com"), "raw has From header");
  assert(
    decodedRaw.includes("multipart/alternative"),
    "text+html becomes multipart/alternative",
  );
  assert(
    encodeRfc2047("Café").startsWith("=?UTF-8?B?"),
    "unicode header is RFC 2047 encoded",
  );
  assert(
    buildMime({
      from: "a@b.com",
      to: ["c@d.com"],
      subject: "Plain",
      text: "body",
    }).includes("Content-Type: text/plain"),
    "text-only stays single part",
  );

  section("phase 1 — mirror upsert is idempotent");
  const userId = makeTestUserId("phase1");
  await createTestUser(userId);

  try {
    const mailbox = await ensureMailbox({
      userId,
      email: `${userId}@example.com`,
    });
    assert(Boolean(mailbox.id), "mailbox ensured");

    const first = await upsertParsedMessage({
      userId,
      mailboxId: mailbox.id,
      parsed,
    });
    const second = await upsertParsedMessage({
      userId,
      mailboxId: mailbox.id,
      parsed: {
        ...parsed,
        snippet: "updated snippet",
        sentAt: new Date(1735689600000 + 60_000),
      },
    });
    assert(first.threadId === second.threadId, "thread upsert is stable");

    const messageRows = await db
      .select()
      .from(messages)
      .where(eq(messages.gmailMessageId, "msg-1"));
    assert(messageRows.length === 1, "re-syncing the same message does not duplicate");

    const threadRows = await db
      .select()
      .from(threads)
      .where(and(eq(threads.userId, userId), eq(threads.gmailThreadId, "thr-1")));
    assert(threadRows.length === 1, "thread upsert is idempotent");
    assert(
      threadRows[0].lastMessageAt?.getTime() === 1735689660000,
      "lastMessageAt advances to the newest message",
    );

    section("phase 1 — send ledger idempotency");
    let sendCalls = 0;
    const sendTransport = async () => {
      sendCalls += 1;
      return jsonResponse({ id: `sent-${sendCalls}`, threadId: "thr-1" });
    };

    const email = {
      from: `${userId}@example.com`,
      to: ["ada@example.com"],
      subject: "Re: Café",
      text: "Sounds good",
    };

    const sent = await sendEmail({
      userId,
      email,
      idempotencyKey: "key-1",
      gmailThreadId: "thr-1",
      transport: sendTransport,
    });
    assert(sent.deduped === false, "first send is not deduped");
    assert(sendCalls === 1, "first send calls Gmail once");

    const resent = await sendEmail({
      userId,
      email,
      idempotencyKey: "key-1",
      transport: sendTransport,
    });
    assert(resent.deduped === true, "replay with same key is deduped");
    assert(sendCalls === 1, "replay does not call Gmail again");

    const secondSend = await sendEmail({
      userId,
      email,
      idempotencyKey: "key-2",
      transport: sendTransport,
    });
    assert(secondSend.deduped === false, "a new key sends normally");
    assert(sendCalls === 2, "new key calls Gmail again");

    let failingCalls = 0;
    const failingTransport = async () => {
      failingCalls += 1;
      return new Response("boom", { status: 500 });
    };
    let threw = false;
    try {
      await sendEmail({
        userId,
        email,
        idempotencyKey: "key-3",
        transport: failingTransport,
      });
    } catch {
      threw = true;
    }
    assert(threw, "failed send throws");
    const retried = await sendEmail({
      userId,
      email,
      idempotencyKey: "key-3",
      transport: async () => {
        failingCalls += 1;
        return jsonResponse({ id: "sent-retry" });
      },
    });
    assert(retried.deduped === false, "a failed key can be retried");
    assert(failingCalls === 2, "retry calls Gmail again after a failure");

    section("phase 1 — event dedupe + watch");
    const evt = await recordEvent({
      userId,
      kind: "gmail.push",
      externalId: "history-1",
      payload: { emailAddress: mailbox.email, historyId: "history-1" },
    });
    assert(evt.isNew === true, "first event is new");
    const evt2 = await recordEvent({
      userId,
      kind: "gmail.push",
      externalId: "history-1",
      payload: { emailAddress: mailbox.email, historyId: "history-1" },
    });
    assert(evt2.isNew === false, "redelivered event is deduped");

    const watchTransport = async () =>
      jsonResponse({ historyId: "9000", expiration: String(Date.now() + 604_800_000) });
    const watch = await registerMailboxWatch({
      userId,
      mailboxId: mailbox.id,
      topicName: "projects/test/topics/gmail",
      transport: watchTransport,
    });
    assert(watch.expiration instanceof Date, "watch expiration recorded");
    const reloaded = await db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.id, mailbox.id));
    assert(
      reloaded[0].watchExpiration !== null,
      "watch expiration persisted on the mailbox",
    );

    section("phase 1 — mail client parsing");
    const clientAddresses = parseClientAddressList(
      '"Ops, Team" <ops@example.com>, bob@example.com',
    );
    assert(clientAddresses.length === 2, "client address list splits");
    assert(
      clientAddresses[0].name === "Ops, Team",
      "client quoted display name preserved",
    );
    assert(
      clientAddresses[0].email === "ops@example.com",
      "client angle-addr parsed",
    );
    assert(
      isUnreachable("no-reply@google.com"),
      "no-reply is flagged unreachable",
    );
    assert(!isUnreachable("sales@acme.com"), "sales@ is a real correspondent");

    section("phase 1 — mailbox self-heal + manual sync enqueue");
    // An already-provisioned user gets the existing row back, untouched.
    const healed = await ensureMailboxForUser(userId);
    assert(
      healed?.id === mailbox.id,
      "self-heal returns the existing mailbox",
    );

    // A user with no linked Google account must decline quietly, not throw.
    const freshUserId = makeTestUserId("phase1b");
    await createTestUser(freshUserId);
    try {
      const none = await ensureMailboxForUser(freshUserId);
      assert(none === null, "self-heal declines without a Google account");
    } finally {
      await deleteTestUser(freshUserId);
    }

    loadJobHandlers();
    assert(
      getJobHandler(JOB_KIND_MAILBOX_SYNC) !== undefined,
      "mailbox_sync handler is registered",
    );

    const manual = await syncInbox(userId);
    assert(manual.accepted === true, "manual sync is accepted");
    const manualJobs = await pool.query<{ kind: string }>(
      "select kind from job_queue where user_id = $1 order by created_at desc limit 1",
      [userId],
    );
    assert(
      manualJobs.rows[0]?.kind === JOB_KIND_MAILBOX_SYNC,
      "syncInbox enqueues a mailbox_sync job",
    );

    section("phase 1 — mailbox_sync pulls Gmail into the mirror");
    const syncTransport = async (
      _transportUserId: string,
      path: string,
    ): Promise<Response> => {
      if (path.startsWith("/messages?")) {
        return jsonResponse({
          messages: [{ id: "msg-sync-1", threadId: "thr-sync-1" }],
        });
      }
      if (path.startsWith("/messages/msg-sync-1")) {
        return jsonResponse({
          ...FIXTURE_MESSAGE,
          id: "msg-sync-1",
          threadId: "thr-sync-1",
        });
      }
      if (path === "/profile") {
        return jsonResponse({
          emailAddress: `${userId}@example.com`,
          historyId: "5000",
        });
      }
      return jsonResponse({});
    };

    const syncResult = await syncMailbox(userId, mailbox.id, syncTransport);
    assert(syncResult.synced >= 1, "syncMailbox mirrored at least one message");

    const syncedThreads = await db
      .select()
      .from(threads)
      .where(
        and(
          eq(threads.userId, userId),
          eq(threads.gmailThreadId, "thr-sync-1"),
        ),
      );
    assert(syncedThreads.length === 1, "syncMailbox created the thread row");
    assert(
      syncedThreads[0].lastMessageAt !== null,
      "mirrored thread carries its last message time",
    );
  } finally {
    await deleteTestUser(userId);
  }
}
