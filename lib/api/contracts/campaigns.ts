import { z } from "zod";

import { defineOperation } from "./registry";
import {
  CAMPAIGN_REPLY_POLICIES,
  createdResponse,
  dataEnvelope,
  okResponse,
} from "./shared";

/**
 * Bulk campaigns (Phase C1). Feature-gated off by default; `POST /campaigns`
 * also accepts `multipart/form-data` (file + mapping), which is not expressed
 * as a JSON schema here.
 */

export const campaignTemplateSchema = z.object({
  subject: z.string().max(500).default(""),
  body: z.string().min(1).max(20_000),
  inlineImageIds: z.array(z.string()).max(20).optional(),
  attachmentIds: z.array(z.string()).max(20).optional(),
});

export const campaignRecipientSchema = z.object({
  email: z.string().min(3).max(320),
  name: z.string().max(200).optional().nullable(),
  rowData: z.record(z.string(), z.string()).optional(),
});

export const campaignCreateBody = z.object({
  name: z.string().min(1).max(200),
  template: campaignTemplateSchema,
  recipients: z.array(campaignRecipientSchema),
  replyPolicy: z.enum(CAMPAIGN_REPLY_POLICIES).optional(),
  footerAddress: z.string().max(500).nullable().optional(),
});

export const campaignPatchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  template: z
    .object({
      subject: z.string().max(500),
      body: z.string().min(1).max(20_000),
      inlineImageIds: z.array(z.string()).max(20).optional(),
      attachmentIds: z.array(z.string()).max(20).optional(),
    })
    .optional(),
  replyPolicy: z.enum(CAMPAIGN_REPLY_POLICIES).optional(),
  footerAddress: z.string().max(500).nullable().optional(),
  throttlePerHour: z.number().int().min(1).max(500).optional(),
});

export const campaignActionBody = z.object({
  action: z.enum(["check", "start", "pause", "resume", "cancel", "test"]),
  confirm: z.boolean().optional(),
});

export const suppressionBody = z.object({
  email: z.string().min(3).max(320),
  reason: z
    .enum(["unsubscribe", "bounce", "manual", "existing_contact", "complaint"])
    .optional(),
});

export const campaignOperations = [
  defineOperation({
    method: "GET",
    path: "/api/v1/campaigns",
    operationId: "listCampaigns",
    tags: ["campaigns"],
    summary: "List campaigns",
    security: "session",
    responses: okResponse(
      dataEnvelope(
        z.object({ campaigns: z.array(z.unknown()), enabled: z.boolean() }),
      ),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/campaigns",
    operationId: "createCampaign",
    tags: ["campaigns"],
    summary: "Create a campaign (JSON or multipart CSV)",
    security: "session",
    body: campaignCreateBody,
    responses: createdResponse(
      dataEnvelope(
        z.object({
          campaignId: z.string(),
          summary: z.unknown(),
          truncated: z.boolean().optional(),
        }),
      ),
    ),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/campaigns/{id}",
    operationId: "getCampaign",
    tags: ["campaigns"],
    summary: "Campaign detail + recipients",
    security: "session",
    responses: okResponse(
      dataEnvelope(
        z.object({
          campaign: z.unknown(),
          stats: z.unknown(),
          recipients: z.array(z.unknown()),
          enabled: z.boolean(),
        }),
      ),
    ),
  }),
  defineOperation({
    method: "PATCH",
    path: "/api/v1/campaigns/{id}",
    operationId: "updateCampaign",
    tags: ["campaigns"],
    summary: "Update a campaign",
    security: "session",
    body: campaignPatchBody,
    responses: okResponse(dataEnvelope(z.object({ campaign: z.unknown() }))),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/campaigns/{id}/actions",
    operationId: "campaignAction",
    tags: ["campaigns"],
    summary: "Campaign lifecycle action (check/start/pause/...)",
    security: "session",
    body: campaignActionBody,
    responses: okResponse(dataEnvelope(z.unknown())),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/campaigns/import",
    operationId: "importCampaignRecipients",
    tags: ["campaigns"],
    summary: "Parse an uploaded CSV and suggest a column mapping",
    security: "session",
    responses: okResponse(
      dataEnvelope(
        z.object({
          headers: z.array(z.string()),
          sampleRows: z.array(z.unknown()),
          rowCount: z.number().int(),
          truncated: z.boolean(),
          suggestedMapping: z.unknown(),
          source: z.string(),
        }),
      ),
    ),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/campaigns/suppression",
    operationId: "listSuppression",
    tags: ["campaigns"],
    summary: "List suppressed addresses",
    security: "session",
    responses: okResponse(
      dataEnvelope(z.object({ suppressed: z.array(z.unknown()) })),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/campaigns/suppression",
    operationId: "addSuppression",
    tags: ["campaigns"],
    summary: "Suppress an address",
    security: "session",
    body: suppressionBody,
    responses: okResponse(dataEnvelope(z.object({ added: z.literal(true) }))),
  }),
] as const;
