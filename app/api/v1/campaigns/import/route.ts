import { apiError, ok, withUser, type UserRouteHandler } from "@/lib/api/http";
import { suggestColumnMapping } from "@/lib/ai/features/campaign-import";
import { parseSpreadsheet } from "@/lib/campaigns/import";
import { campaignMaxRecipients, isCampaignsEnabled } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Import preview (Phase 7 step 1): parse an uploaded sheet and propose a column
 * mapping. Nothing is persisted — the wizard confirms the mapping before the
 * campaign is created.
 */
const handleImport: UserRouteHandler = async (userId, request) => {
  if (!isCampaignsEnabled()) {
    return apiError("disabled", "Campaigns are disabled.", 403);
  }

  const form = await request.formData().catch(() => null);
  if (!form) return apiError("bad_request", "Expected form data.", 400);

  const file = form.get("file");
  if (!(file instanceof File)) return apiError("bad_request", "Missing file.", 400);
  if (file.size > 10 * 1024 * 1024) {
    return apiError("too_large", "That file is too large (10 MB maximum).", 413);
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

  const { mapping, source } = await suggestColumnMapping({
    userId,
    headers: sheet.headers,
    sampleRows: sheet.rows.slice(0, 3),
  });

  return ok({
    headers: sheet.headers,
    sampleRows: sheet.rows.slice(0, 5),
    rowCount: sheet.rows.length,
    truncated: sheet.truncated,
    suggestedMapping: mapping,
    source,
  });
};

export const POST = withUser(
  {
    rateLimit: { limit: 10, scope: "campaigns-import" },
    // A 10 MB sheet plus multipart overhead.
    maxBodyBytes: 11 * 1024 * 1024,
  },
  handleImport,
);
