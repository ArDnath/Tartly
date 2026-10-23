import { createToolRegistry, type ToolRegistry } from "@/lib/agent/registry";
import { toolGroupFor } from "@/lib/agent/tool-groups";

import { addLabelTool } from "./add-label";
import { addAssetTool } from "./add-asset";
import { addSuppressionTool } from "./add-suppression";
import { archiveEmailTool } from "./archive-email";
import { checkCalendarAvailabilityTool } from "./check-calendar-availability";
import { createDraftTool } from "./create-draft";
import { createFollowupTool } from "./create-followup";
import { createRuleTool } from "./create-rule";
import { deleteEmailTool } from "./delete-email";
import { draftInMyVoiceTool } from "./draft-in-my-voice";
import { explainAutopilotDecisionTool } from "./explain-autopilot-decision";
import { extractTasksTool } from "./extract-tasks";
import { forwardEmailTool } from "./forward-email";
import { getAiCostTool } from "./get-ai-cost";
import { getCampaignStatusTool } from "./get-campaign-status";
import { getCommitmentsTool } from "./get-commitments";
import { getContactTool } from "./get-contact";
import { getEmailTool } from "./get-email";
import { getOvernightSummaryTool } from "./get-overnight-summary";
import { getSenderProfileTool } from "./get-sender-profile";
import { getThreadTool } from "./get-thread";
import { listAssetsTool } from "./list-assets";
import { markEmailReadTool } from "./mark-email-read";
import { openWebPageTool } from "./open-web-page";
import { pauseAutopilotTool } from "./pause-autopilot";
import { removeLabelTool } from "./remove-label";
import { replyToEmailTool } from "./reply-to-email";
import { researchCompanyTool } from "./research-company";
import { researchPersonTool } from "./research-person";
import { scheduleEmailTool } from "./schedule-email";
import { searchCalendarTool } from "./search-calendar";
import { searchContactsTool } from "./search-contacts";
import { searchEmailsTool } from "./search-emails";
import { searchKnowledgeTool } from "./search-knowledge";
import { searchWebTool } from "./search-web";
import { sendEmailTool } from "./send-email";
import { setAutopilotPolicyTool } from "./set-autopilot-policy";
import { setThreadAutonomyTool } from "./set-thread-autonomy";
import { startCampaignTool } from "./start-campaign";
import { starEmailTool } from "./star-email";
import { summarizeThreadTool } from "./summarize-thread";
import { unsubscribeSenderTool } from "./unsubscribe-sender";
import { updateCalendarTool } from "./update-calendar";
import { updateDraftTool } from "./update-draft";

/**
 * The default tool set available to the agent.
 *
 * READ tools read; WRITE tools perform reversible mailbox mutations (drafts,
 * labels, read state, archive) and run without confirmation. EXTERNAL_SIDE_EFFECT
 * tools (send, reply, forward, delete, schedule) can only ever *propose* an
 * action: the deterministic permission engine turns them into a persisted
 * `pending_action` and the tool's `execute` runs solely from the confirmed-action
 * executor.
 */

export const READ_TOOLS = [
  searchEmailsTool,
  getEmailTool,
  getThreadTool,
  searchContactsTool,
  getContactTool,
  searchWebTool,
  openWebPageTool,
  researchPersonTool,
  researchCompanyTool,
  extractTasksTool,
  searchKnowledgeTool,
  getAiCostTool,
  summarizeThreadTool,
  getSenderProfileTool,
  listAssetsTool,
  getCampaignStatusTool,
  getCommitmentsTool,
  getOvernightSummaryTool,
  explainAutopilotDecisionTool,
  searchCalendarTool,
  checkCalendarAvailabilityTool,
];

export const WRITE_TOOLS = [
  createDraftTool,
  draftInMyVoiceTool,
  updateDraftTool,
  addLabelTool,
  removeLabelTool,
  archiveEmailTool,
  markEmailReadTool,
  starEmailTool,
  createFollowupTool,
  createRuleTool,
  addAssetTool,
  startCampaignTool,
  addSuppressionTool,
  setThreadAutonomyTool,
  setAutopilotPolicyTool,
  pauseAutopilotTool,
];

export const SIDE_EFFECT_TOOLS = [
  sendEmailTool,
  replyToEmailTool,
  forwardEmailTool,
  deleteEmailTool,
  scheduleEmailTool,
  unsubscribeSenderTool,
  updateCalendarTool,
];

export function createDefaultToolRegistry(
  options: { webSearch?: boolean } = {},
): ToolRegistry {
  const all = [...READ_TOOLS, ...WRITE_TOOLS, ...SIDE_EFFECT_TOOLS];
  // The composer's web-search toggle: when off, the research tools (search_web,
  // open_web_page, research_*) are removed entirely so the model cannot call
  // them. On by default for every non-composer caller.
  const tools =
    options.webSearch === false
      ? all.filter((tool) => toolGroupFor(tool.name) !== "research")
      : all;
  return createToolRegistry(tools);
}

export {
  addLabelTool,
  addAssetTool,
  addSuppressionTool,
  archiveEmailTool,
  checkCalendarAvailabilityTool,
  createDraftTool,
  createFollowupTool,
  createRuleTool,
  deleteEmailTool,
  draftInMyVoiceTool,
  explainAutopilotDecisionTool,
  extractTasksTool,
  forwardEmailTool,
  getAiCostTool,
  getCampaignStatusTool,
  getCommitmentsTool,
  getContactTool,
  getEmailTool,
  getOvernightSummaryTool,
  getSenderProfileTool,
  getThreadTool,
  listAssetsTool,
  markEmailReadTool,
  openWebPageTool,
  pauseAutopilotTool,
  removeLabelTool,
  replyToEmailTool,
  researchCompanyTool,
  researchPersonTool,
  scheduleEmailTool,
  searchCalendarTool,
  searchContactsTool,
  searchEmailsTool,
  searchKnowledgeTool,
  searchWebTool,
  sendEmailTool,
  setAutopilotPolicyTool,
  setThreadAutonomyTool,
  startCampaignTool,
  summarizeThreadTool,
  starEmailTool,
  unsubscribeSenderTool,
  updateCalendarTool,
  updateDraftTool,
};
