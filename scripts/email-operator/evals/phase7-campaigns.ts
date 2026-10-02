import {
  buildCampaignBody,
  extractAiBlocks,
  extractMergeFields,
  renderTemplate,
} from "../../../lib/campaigns/template";
import {
  mapRowsToRecipients,
  parseCsv,
} from "../../../lib/campaigns/import";
import {
  heuristicMapping,
  sanitizeMapping,
} from "../../../lib/ai/features/campaign-import";
import {
  addSuppression,
  cancelCampaign,
  claimRecipientBatch,
  createCampaign,
  isSuppressed,
} from "../../../lib/campaigns/service";
import { evaluateCampaignGuardrails } from "../../../lib/ai/features/spam-check";
import {
  buildOutOfOfficeAck,
  canAutoRespond,
  deterministicReplyClass,
  impliesCommitment,
} from "../../../lib/ai/features/campaign-reply";
import { db } from "../../../lib/db";
import { bulkRecipients } from "../../../lib/db/schema";
import { eq } from "drizzle-orm";
import {
  assert,
  createTestUser,
  deleteTestUser,
  makeTestUserId,
  section,
} from "../harness";

/**
 * Phase 7 — bulk campaigns.
 *
 * Deterministic pure checks (template merge/AI blocks, column mapping, reply
 * classification, quality gate) plus DB-backed invariants (suppression, no
 * double-claim, cancel skips pending). No model or Gmail call is made.
 */

export async function run(): Promise<void> {
  section("phase 7 — template merge + AI blocks");
  const template =
    "Hi {{name}},\n\n{{AI: one line about {{company}}}}\n\n— the {{Company}} team";
  const fields = extractMergeFields(template);
  assert(
    fields.some((field) => field.key === "name") &&
      fields.some((field) => field.key === "company"),
    "merge fields are extracted case-insensitively (AI blocks excluded)",
  );
  assert(extractAiBlocks(template).length === 1, "AI blocks are extracted separately");

  const nested = "Hi,\n\n{{AI: mention {{company}} warmly}}\n\nBye";
  const nestedBlocks = extractAiBlocks(nested);
  assert(
    nestedBlocks.length === 1 &&
      nestedBlocks[0]!.instruction === "mention {{company}} warmly",
    "an AI block with a nested merge field parses with balanced braces",
  );
  const nestedRendered = renderTemplate({
    template: nested,
    data: { company: "Acme" },
    aiValues: { 0: "Acme is doing great work." },
  });
  assert(
    nestedRendered === "Hi,\n\nAcme is doing great work.\n\nBye",
    "a nested AI block renders to its generated line with no stray braces",
  );

  const rendered = renderTemplate({
    template,
    data: { name: "Ada", company: "Acme" },
    aiValues: { 0: "Loved your launch." },
  });
  assert(
    rendered.includes("Ada") &&
      rendered.includes("Loved your launch.") &&
      !rendered.includes("{{"),
    "merge fields and AI values are filled with no leftover braces",
  );

  const dropped = renderTemplate({
    template: "Hi {{name}},\n\n{{AI: say something}}\n\nBye",
    data: { name: "Ada" },
  });
  assert(
    dropped.includes("Ada") && !dropped.includes("{{") && !dropped.includes("say something"),
    "an unfilled AI block is dropped, never sent as braces",
  );

  const unknown = renderTemplate({ template: "Hello {{missing}}", data: {} });
  assert(unknown === "Hello", "an unknown merge field becomes empty, not a placeholder");
  assert(
    buildCampaignBody("Hi there", ["cid-1"]).includes('src="cid:cid-1"'),
    "campaign HTML references inline images by cid",
  );

  section("phase 7 — column mapping guards");
  const headers = ["Email Address", "Full Name", "Company", "Unsubscribed"];
  const rows = [
    ["ada@acme.com", "Ada Lovelace", "Acme", ""],
    ["grace@navy.mil", "Grace Hopper", "Navy", ""],
  ];
  const heuristic = heuristicMapping(headers, rows);
  assert(heuristic.emailColumn === "Email Address", "the email column is detected");
  assert(heuristic.nameColumn === "Full Name", "the name column is detected");
  assert(heuristic.companyColumn === "Company", "the company column is detected");

  const invented = sanitizeMapping(
    { ...heuristic, emailColumn: "Ghost Column", custom: { role: "Job Title" } },
    headers,
  );
  assert(
    invented.emailColumn === null && !("role" in invented.custom),
    "a model-invented column is dropped, not trusted",
  );

  const csv = parseCsv('email,name\n"ada@acme.com","Lovelace, Ada"\n', 10);
  assert(
    csv.headers.length === 2 && csv.rows[0]?.[1] === "Lovelace, Ada",
    "quoted CSV fields are parsed correctly",
  );
  const mapped = mapRowsToRecipients({
    headers: csv.headers,
    rows: csv.rows,
    mapping: { emailColumn: "email", nameColumn: "name", companyColumn: null, custom: {} },
  });
  assert(
    mapped[0]?.email === "ada@acme.com" && mapped[0]?.rowData.name === "Lovelace, Ada",
    "rows map onto recipients with merge data",
  );

  section("phase 7 — reply classification safety");
  assert(
    deterministicReplyClass({
      from: "mailer-daemon@google.com",
      subject: "Delivery Status Notification",
      body: "Undeliverable",
    }) === "bounce",
    "bounces are detected deterministically",
  );
  assert(
    deterministicReplyClass({
      from: "ada@acme.com",
      subject: "Re",
      body: "Please unsubscribe me",
    }) === "unsubscribe",
    "unsubscribe requests are detected deterministically",
  );
  assert(
    deterministicReplyClass({
      from: "ada@acme.com",
      subject: "Out of office",
      body: "I am currently away",
    }) === "out_of_office",
    "out-of-office is detected deterministically",
  );
  assert(
    canAutoRespond("out_of_office") && !canAutoRespond("interested") && !canAutoRespond("question"),
    "only out-of-office may be answered automatically",
  );
  assert(
    impliesCommitment("we can offer a 20% discount") &&
      !impliesCommitment("thanks, talk soon"),
    "commitment language is detected, so auto-replies refuse to commit",
  );
  assert(buildOutOfOfficeAck().length > 0, "the out-of-office acknowledgement is non-empty");

  section("phase 7 — quality gate blocks forbidden claims");
  assert(
    evaluateCampaignGuardrails("We guarantee 100% results").violations.length > 0,
    "a guaranteed/100% claim is a deterministic quality violation",
  );
  assert(
    evaluateCampaignGuardrails("Hi {{name}}, quick question about your team").violations
      .length === 0,
    "a clean template passes the deterministic checks",
  );

  section("phase 7 — suppression, dedupe and at-most-once claim");
  const userId = makeTestUserId("phase7");
  await createTestUser(userId);
  try {
    await addSuppression({ userId, email: "blocked@x.com", reason: "unsubscribe" });
    assert(await isSuppressed({ userId, email: "BLOCKED@x.com" }), "suppression is case-insensitive");

    const { campaignId, summary } = await createCampaign({
      userId,
      name: "Phase 7 test",
      template: { subject: "Hi {{name}}", body: "Hello {{name}}" },
      recipients: [
        { email: "ok@x.com", name: "Ok", rowData: { name: "Ok" } },
        { email: "OK@x.com", name: "Dup", rowData: { name: "Dup" } },
        { email: "not-an-email", name: null, rowData: {} },
        { email: "blocked@x.com", name: null, rowData: {} },
      ],
    });
    assert(summary.imported === 1, "only one valid, non-suppressed recipient is imported");
    assert(
      summary.duplicate === 1 && summary.invalid === 1 && summary.suppressed === 1,
      "duplicates, invalid and suppressed addresses are counted and dropped",
    );

    const first = await claimRecipientBatch({ campaignId, limit: 5 });
    assert(first.length === 1, "the first claim takes the pending recipient");
    const second = await claimRecipientBatch({ campaignId, limit: 5 });
    assert(second.length === 0, "a second claim cannot take the same recipient twice");

    const cancelled = await cancelCampaign({ userId, campaignId });
    const rows = await db
      .select({ status: bulkRecipients.status })
      .from(bulkRecipients)
      .where(eq(bulkRecipients.campaignId, campaignId));
    assert(cancelled, "cancel marks the campaign cancelled");
    assert(
      rows.every((row) => row.status !== "pending"),
      "cancel skips every pending recipient",
    );
  } finally {
    await deleteTestUser(userId);
  }
}
