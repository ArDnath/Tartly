import { z } from "zod";

import { apiError, ok, withUser } from "@/lib/api/http";
import { mapRowsToRecipients, parseSpreadsheet } from "@/lib/campaigns/import";
import { addSuppression, createCampaign, listCampaignsWithStats } from "@/lib/campaigns/service";
import { campaignMaxRecipients, isCampaignsEnabled } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 60;

const templateSchema = z.object({
  subject: z.string().max(500).default(""),
  body: z.string().min(1).max(20_000),
  inlineImageIds: z.array(z.string()).max(20).optional(),
  attachmentIds: z.array(z.string()).max(20).optional(),
});

const mappingSchema = z.object({
  emailColumn: z.string().nullable(),
  nameColumn: z.string().nullable(),
  companyColumn: z.string().nullable(),
  unsubscribeColumn: z.string().nullable().optional(),
  custom: z.record(z.string(), z.string()).default({}),
});

const recipientSchema = z.object({
  email: z.string().min(3).max(320),
  name: z.string().max(200).optional().nullable(),
  rowData: z.record(z.string(), z.string()).optional(),
});

/** List and create campaigns (Phase 7). */
export const GET = withUser(async (userId) => {
  const campaigns = await listCampaignsWithStats(userId);
  return ok({
    campaigns: campaigns.map(({ campaign, stats, total }) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      replyPolicy: campaign.replyPolicy,
      total,
      stats,
      createdAt: campaign.createdAt.toISOString(),
      startedAt: campaign.startedAt?.toISOString() ?? null,
      finishedAt: campaign.finishedAt?.toISOString() ?? null,
    })),
    enabled: isCampaignsEnabled(),
  });
});

export const POST = withUser(async (userId, request) => {
  if (!isCampaignsEnabled()) {
    return apiError("disabled", "Campaigns are disabled.", 403);
  }

  const contentType = request.headers.get("content-type") ?? "";

  // --- Multipart: file import with a column mapping ---
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return apiError("bad_request", "Expected form data.", 400);

    const file = form.get("file");
    if (!(file instanceof File)) return apiError("bad_request", "Missing file.", 400);

    const mappingRaw = form.get("mapping");
    const mapping = mappingSchema.safeParse(
      typeof mappingRaw === "string" ? JSON.parse(mappingRaw) : undefined,
    );
    if (!mapping.success) return apiError("bad_request", "Invalid mapping.", 400);

    const name = String(form.get("name") ?? "").slice(0, 200) || file.name;
    const template = templateSchema.safeParse({
      subject: String(form.get("subject") ?? ""),
      body: String(form.get("body") ?? ""),
      inlineImageIds: parseJsonArray(form.get("inlineImageIds")),
      attachmentIds: parseJsonArray(form.get("attachmentIds")),
    });
    if (!template.success) {
      return apiError("bad_request", "A subject and body are required.", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sheet = await parseSpreadsheet({
      filename: file.name,
      buffer,
      maxRows: campaignMaxRecipients(),
    });
    if (sheet.headers.length === 0) {
      return apiError("bad_request", "That file has no columns.", 400);
    }

    const recipients = mapRowsToRecipients({
      headers: sheet.headers,
      rows: sheet.rows,
      mapping: {
        emailColumn: mapping.data.emailColumn,
        nameColumn: mapping.data.nameColumn,
        companyColumn: mapping.data.companyColumn,
        custom: mapping.data.custom,
      },
    });

    // A row the source marks as unsubscribed is suppressed, not emailed.
    const unsubscribeIndex = mapping.data.unsubscribeColumn
      ? sheet.headers.indexOf(mapping.data.unsubscribeColumn)
      : -1;
    const OPT_OUT = new Set([
      "y",
      "yes",
      "true",
      "1",
      "unsubscribed",
      "unsubscribe",
      "opted out",
      "opt-out",
      "opt out",
    ]);
    const kept: typeof recipients = [];
    const optedOut: string[] = [];
    recipients.forEach((recipient, index) => {
      if (unsubscribeIndex >= 0) {
        const value = (sheet.rows[index]?.[unsubscribeIndex] ?? "").trim().toLowerCase();
        if (OPT_OUT.has(value)) {
          optedOut.push(recipient.email);
          return;
        }
      }
      kept.push(recipient);
    });
    await Promise.all(
      optedOut.map((email) => addSuppression({ userId, email, reason: "unsubscribe" })),
    );

    const { campaignId, summary } = await createCampaign({
      userId,
      name,
      template: template.data,
      recipients: kept,
      replyPolicy: String(form.get("replyPolicy") ?? "drafts"),
      footerAddress: (String(form.get("footerAddress") ?? "").trim() || null) as
        | string
        | null,
    });
    return ok({ campaignId, summary, truncated: sheet.truncated });
  }

  // --- JSON: small lists (and tests) ---
  const schema = z.object({
    name: z.string().min(1).max(200),
    template: templateSchema,
    recipients: z.array(recipientSchema).max(campaignMaxRecipients()),
    replyPolicy: z.enum(["off", "drafts", "autopilot"]).optional(),
    footerAddress: z.string().max(500).nullable().optional(),
  });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  const { campaignId, summary } = await createCampaign({
    userId,
    name: parsed.data.name,
    template: parsed.data.template,
    recipients: parsed.data.recipients.map((recipient) => ({
      email: recipient.email,
      name: recipient.name ?? null,
      rowData: recipient.rowData ?? {},
    })),
    replyPolicy: parsed.data.replyPolicy ?? "drafts",
    footerAddress: parsed.data.footerAddress ?? null,
  });
  return ok({ campaignId, summary });
});

function parseJsonArray(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}
