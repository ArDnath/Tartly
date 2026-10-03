import { z } from "zod";

import { defineOperation } from "./registry";
import {
  createdResponse,
  cursorQuery,
  dataEnvelope,
  noContentResponse,
  okResponse,
  RULE_ACTION_TYPES,
} from "./shared";

/**
 * Settings surfaces: autonomy, rules, knowledge, calendar, assistant, memories,
 * senders and snippets (Phase C1).
 */

export const autonomyPatchBody = z.object({
  mailboxAutonomy: z.enum(["copilot", "autopilot"]).optional(),
  contact: z
    .object({
      email: z.string().email(),
      override: z.enum(["copilot", "autopilot"]).nullable(),
    })
    .optional(),
});

export const ruleTestBody = z.object({
  instructions: z.string().min(4).max(2_000).optional(),
  ruleId: z.string().min(1).max(200).optional(),
  email: z.object({
    from: z.string().max(320).default(""),
    subject: z.string().max(320).default(""),
    body: z.string().max(8_000).default(""),
    categories: z.array(z.string().max(60)).max(12).default([]),
  }),
});

export const knowledgeCreateBody = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(8_000),
});

export const knowledgePatchBody = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(8_000).optional(),
});

export const calendarPatchBody = z.object({
  timezone: z.string().min(1).max(100).optional(),
  workDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  workStartHour: z.number().int().min(0).max(23).optional(),
  workEndHour: z.number().int().min(1).max(24).optional(),
  bufferMins: z.number().int().min(0).max(180).optional(),
  defaultDurationMins: z.number().int().min(5).max(480).optional(),
});

export const ruleConditionSchema = z.object({
  logic: z.enum(["AND", "OR"]).default("AND"),
  ai: z.string().max(500).nullable().default(null),
  from: z.string().max(320).nullable().default(null),
  to: z.string().max(320).nullable().default(null),
  subject: z.string().max(320).nullable().default(null),
  categories: z.array(z.string().max(60)).max(12).default([]),
  hasUnsubscribe: z.boolean().optional(),
  coldEmail: z.boolean().optional(),
});

export const ruleActionSchema = z.object({
  type: z.enum(RULE_ACTION_TYPES),
  fields: z.record(z.string(), z.string()).default({}),
  delayMinutes: z.number().int().min(0).max(10_080).optional(),
});

/** The manual-rule action shape: a known set of field keys (create form). */
export const ruleManualActionSchema = z.object({
  type: z.enum(RULE_ACTION_TYPES),
  fields: z
    .object({
      label: z.string().max(120).optional(),
      folder: z.string().max(120).optional(),
      instruction: z.string().max(1_000).optional(),
      to: z.string().max(320).optional(),
      message: z.string().max(500).optional(),
      digest: z.string().max(120).optional(),
    })
    .default({}),
  delayMinutes: z.number().int().min(0).max(10_080).optional(),
});

export const rulesCreateBody = z.union([
  z.object({ instructions: z.string().min(4).max(2_000) }),
  z.object({
    name: z.string().min(1).max(120),
    condition: ruleConditionSchema,
    actions: z.array(ruleManualActionSchema).min(1).max(6),
  }),
]);

export const rulesPatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(9_999).optional(),
  condition: ruleConditionSchema.optional(),
  actions: z.array(ruleActionSchema).min(1).max(6).optional(),
});

export const assistantPatchBody = z.object({
  voiceEnabled: z.boolean().optional(),
  memoryEnabled: z.boolean().optional(),
  knowledgeEnabled: z.boolean().optional(),
  draftConfidence: z.enum(["all", "standard", "high"]).optional(),
  explicitWritingStyle: z.string().max(2_000).nullable().optional(),
  meetingBriefsEnabled: z.boolean().optional(),
  digestFrequency: z.enum(["off", "daily", "weekly"]).optional(),
  briefingEnabled: z.boolean().optional(),
  briefingHour: z.number().int().min(0).max(23).optional(),
  commitmentsEnabled: z.boolean().optional(),
  memoryAutoExtract: z.boolean().optional(),
  overnightReviewEnabled: z.boolean().optional(),
});

/* --- 24/7 autopilot -------------------------------------------------------- */

export const AUTOPILOT_CATEGORY_VALUES = [
  "needs_reply",
  "meeting_request",
  "awaiting_reply",
  "fyi",
  "invoice",
  "newsletter",
  "spam",
] as const;

export const autopilotPolicyPatchBody = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["window", "always"]).optional(),
  timezone: z.string().min(1).max(100).optional(),
  days: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  windowStartHour: z.number().int().min(0).max(23).optional(),
  windowEndHour: z.number().int().min(0).max(23).optional(),
  minConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  requireKnownSender: z.boolean().optional(),
  allowedCategories: z.array(z.enum(AUTOPILOT_CATEGORY_VALUES)).max(7).optional(),
  maxPerHour: z.number().int().min(1).max(1_000).optional(),
  maxPerDay: z.number().int().min(1).max(10_000).optional(),
  maxPerThread: z.number().int().min(1).max(100).optional(),
  loopThreshold: z.number().int().min(1).max(50).optional(),
  morningReview: z.boolean().optional(),
});

export const autopilotPauseBody = z.object({
  alsoSetCopilot: z.boolean().optional(),
});

export const autopilotPreviewBody = z.object({
  limit: z.number().int().min(1).max(25).optional(),
});

export const autopilotDecisionsQuery = cursorQuery({
  since: z.string().optional(),
});

export const assistantActionBody = z.object({ action: z.literal("analyze-style") });

export const sendersPatchBody = z.object({
  senderIntelEnabled: z.boolean().optional(),
  coldEmailAction: z.enum(["label", "archive", "none"]).optional(),
  autoArchiveNoise: z.boolean().optional(),
});

export const senderPatchBody = z.object({
  status: z.enum(["active", "allowed", "blocked"]),
});

export const snippetCreateBody = z.object({
  shortcut: z.string().min(1).max(60),
  content: z.string().min(1).max(4_000),
});

export const snippetPatchBody = z.object({
  shortcut: z.string().min(1).max(60).optional(),
  content: z.string().min(1).max(4_000).optional(),
});

const updatedSchema = dataEnvelope(z.object({ updated: z.literal(true) }));

export const settingsOperations = [
  defineOperation({
    method: "GET",
    path: "/api/v1/settings/autonomy",
    operationId: "getAutonomySettings",
    tags: ["settings"],
    summary: "Read mailbox + per-contact autonomy",
    security: "session",
    responses: okResponse(dataEnvelope(z.unknown())),
  }),
  defineOperation({
    method: "PATCH",
    path: "/api/v1/settings/autonomy",
    operationId: "updateAutonomySettings",
    tags: ["settings"],
    summary: "Update mailbox + per-contact autonomy",
    security: "session",
    body: autonomyPatchBody,
    responses: okResponse(dataEnvelope(z.unknown())),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/settings/rules/test",
    operationId: "testRule",
    tags: ["settings"],
    summary: "Dry-run a rule against a sample email",
    security: "session",
    body: ruleTestBody,
    responses: okResponse(
      dataEnvelope(
        z.object({
          rule: z.unknown(),
          matched: z.boolean(),
          reason: z.unknown(),
        }),
      ),
    ),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/settings/knowledge",
    operationId: "listKnowledge",
    tags: ["settings"],
    summary: "List knowledge entries",
    security: "session",
    responses: okResponse(
      dataEnvelope(z.object({ entries: z.array(z.unknown()) })),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/settings/knowledge",
    operationId: "createKnowledge",
    tags: ["settings"],
    summary: "Create a knowledge entry",
    security: "session",
    body: knowledgeCreateBody,
    responses: createdResponse(dataEnvelope(z.object({ entry: z.unknown() }))),
  }),
  defineOperation({
    method: "PATCH",
    path: "/api/v1/settings/knowledge/{id}",
    operationId: "updateKnowledge",
    tags: ["settings"],
    summary: "Update a knowledge entry",
    security: "session",
    body: knowledgePatchBody,
    responses: okResponse(updatedSchema),
  }),
  defineOperation({
    method: "DELETE",
    path: "/api/v1/settings/knowledge/{id}",
    operationId: "deleteKnowledge",
    tags: ["settings"],
    summary: "Delete a knowledge entry",
    security: "session",
    responses: noContentResponse(),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/settings/calendar",
    operationId: "getCalendarSettings",
    tags: ["settings"],
    summary: "Read calendar working preferences",
    security: "session",
    responses: okResponse(dataEnvelope(z.unknown())),
  }),
  defineOperation({
    method: "PATCH",
    path: "/api/v1/settings/calendar",
    operationId: "updateCalendarSettings",
    tags: ["settings"],
    summary: "Update calendar working preferences",
    security: "session",
    body: calendarPatchBody,
    responses: okResponse(dataEnvelope(z.unknown())),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/settings/rules",
    operationId: "listRules",
    tags: ["settings"],
    summary: "List automation rules + recent executions",
    security: "session",
    responses: okResponse(
      dataEnvelope(
        z.object({
          rules: z.array(z.unknown()),
          executions: z.array(z.unknown()),
          compilerAvailable: z.boolean(),
        }),
      ),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/settings/rules",
    operationId: "createRule",
    tags: ["settings"],
    summary: "Create a rule (AI instructions or manual)",
    security: "session",
    body: rulesCreateBody,
    responses: createdResponse(dataEnvelope(z.object({ rule: z.unknown() }))),
  }),
  defineOperation({
    method: "PATCH",
    path: "/api/v1/settings/rules/{id}",
    operationId: "updateRule",
    tags: ["settings"],
    summary: "Update a rule",
    security: "session",
    body: rulesPatchBody,
    responses: okResponse(
      dataEnvelope(z.object({ id: z.string(), updated: z.literal(true) })),
    ),
  }),
  defineOperation({
    method: "DELETE",
    path: "/api/v1/settings/rules/{id}",
    operationId: "deleteRule",
    tags: ["settings"],
    summary: "Delete a rule",
    security: "session",
    responses: noContentResponse(),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/settings/assistant",
    operationId: "getAssistantSettings",
    tags: ["settings"],
    summary: "Read the assistant overview",
    security: "session",
    responses: okResponse(dataEnvelope(z.unknown())),
  }),
  defineOperation({
    method: "PATCH",
    path: "/api/v1/settings/assistant",
    operationId: "updateAssistantSettings",
    tags: ["settings"],
    summary: "Update assistant settings",
    security: "session",
    body: assistantPatchBody,
    responses: okResponse(dataEnvelope(z.unknown())),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/settings/assistant",
    operationId: "runAssistantAction",
    tags: ["settings"],
    summary: "Re-analyze writing style",
    security: "session",
    body: assistantActionBody,
    responses: okResponse(dataEnvelope(z.unknown())),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/settings/memories",
    operationId: "listMemories",
    tags: ["settings"],
    summary: "List assistant memories",
    security: "session",
    responses: okResponse(
      dataEnvelope(z.object({ memories: z.array(z.unknown()) })),
    ),
  }),
  defineOperation({
    method: "DELETE",
    path: "/api/v1/settings/memories/{id}",
    operationId: "deleteMemory",
    tags: ["settings"],
    summary: "Archive a memory",
    security: "session",
    responses: noContentResponse(),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/settings/senders",
    operationId: "listSenders",
    tags: ["settings"],
    summary: "Read sender settings + profiles",
    security: "session",
    responses: okResponse(
      dataEnvelope(
        z.object({
          settings: z.unknown(),
          categoryCounts: z.unknown(),
          senders: z.array(z.unknown()),
        }),
      ),
    ),
  }),
  defineOperation({
    method: "PATCH",
    path: "/api/v1/settings/senders",
    operationId: "updateSenderSettings",
    tags: ["settings"],
    summary: "Update sender-intelligence settings",
    security: "session",
    body: sendersPatchBody,
    responses: okResponse(dataEnvelope(z.object({ settings: z.unknown() }))),
  }),
  defineOperation({
    method: "PATCH",
    path: "/api/v1/settings/senders/{id}",
    operationId: "updateSenderProfile",
    tags: ["settings"],
    summary: "Set a sender's allow/block status",
    security: "session",
    body: senderPatchBody,
    responses: okResponse(
      dataEnvelope(z.object({ id: z.string(), status: z.string() })),
    ),
  }),
  defineOperation({
    method: "DELETE",
    path: "/api/v1/settings/senders/{id}",
    operationId: "forgetSenderProfile",
    tags: ["settings"],
    summary: "Forget a sender profile",
    security: "session",
    responses: noContentResponse(),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/settings/snippets",
    operationId: "listSnippets",
    tags: ["settings"],
    summary: "List snippets",
    security: "session",
    responses: okResponse(
      dataEnvelope(z.object({ snippets: z.array(z.unknown()) })),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/settings/snippets",
    operationId: "createSnippet",
    tags: ["settings"],
    summary: "Create a snippet",
    security: "session",
    body: snippetCreateBody,
    responses: createdResponse(dataEnvelope(z.object({ snippet: z.unknown() }))),
  }),
  defineOperation({
    method: "PATCH",
    path: "/api/v1/settings/snippets/{id}",
    operationId: "updateSnippet",
    tags: ["settings"],
    summary: "Update a snippet",
    security: "session",
    body: snippetPatchBody,
    responses: okResponse(updatedSchema),
  }),
  defineOperation({
    method: "DELETE",
    path: "/api/v1/settings/snippets/{id}",
    operationId: "deleteSnippet",
    tags: ["settings"],
    summary: "Delete a snippet",
    security: "session",
    responses: noContentResponse(),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/settings/autopilot",
    operationId: "getAutopilotPolicy",
    tags: ["settings", "autopilot"],
    summary: "Read the 24/7 autopilot policy for the connected mailbox",
    security: "session",
    responses: okResponse(dataEnvelope(z.unknown())),
  }),
  defineOperation({
    method: "PATCH",
    path: "/api/v1/settings/autopilot",
    operationId: "updateAutopilotPolicy",
    tags: ["settings", "autopilot"],
    summary: "Update the autopilot policy (clamped to platform ceilings)",
    security: "session",
    body: autopilotPolicyPatchBody,
    responses: okResponse(dataEnvelope(z.unknown())),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/settings/autopilot/pause",
    operationId: "pauseAutopilot",
    tags: ["settings", "autopilot"],
    summary: "Kill switch: pause all automatic sending",
    security: "session",
    body: autopilotPauseBody,
    responses: okResponse(dataEnvelope(z.unknown())),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/settings/autopilot/preview",
    operationId: "previewAutopilot",
    tags: ["settings", "autopilot"],
    summary: "Dry-run the gate over recent threads (no sends, no writes)",
    security: "session",
    body: autopilotPreviewBody,
    responses: okResponse(dataEnvelope(z.unknown())),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/autopilot/decisions",
    operationId: "listAutopilotDecisions",
    tags: ["autopilot"],
    summary: "Paginated, content-free autopilot decision audit",
    security: "session",
    query: autopilotDecisionsQuery,
    responses: okResponse(dataEnvelope(z.unknown())),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/cron/autopilot",
    operationId: "runAutopilotReview",
    tags: ["autopilot", "cron"],
    summary: "Finalize the overnight review (bearer CRON_SECRET)",
    security: "cron",
    responses: okResponse(dataEnvelope(z.unknown())),
  }),
] as const;
